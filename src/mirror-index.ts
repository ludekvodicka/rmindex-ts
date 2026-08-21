import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

import Database from "better-sqlite3";

import { pathOf, readMirrorEntries, readMirrorState } from "./mirror-files.js";

export interface MirrorIndexOptions {
  /** Overrides where the database lives; defaults to `<mirrorRoot>/derived/index.sqlite`. */
  readonly databasePath?: string;
}

export interface IndexedDocument {
  readonly id: string;
  readonly name: string;
  /** Folder path plus name, for example "Work/Projects/Notebook". */
  readonly path: string;
  readonly type: "document" | "folder";
  readonly fileType: string | null;
  readonly parentId: string | null;
  readonly pageCount: number;
  readonly modifiedMs: number | null;
}

export interface SearchHit {
  readonly document: IndexedDocument;
  readonly pageNumber: number | null;
  /** Text around the match, with the matched terms surrounded by the excerpt markers. */
  readonly excerpt: string;
}

export interface SearchOptions {
  readonly limit?: number;
}

export interface OpenDocumentState {
  readonly documentId: string | null;
  readonly name: string | null;
  readonly pageNumber: number | null;
  /** When the mirror this answer comes from was last synced; null when it never was. */
  readonly lastSyncAt: string | null;
}

export interface RebuildResult {
  readonly documents: number;
  readonly folders: number;
  /** Documents whose files could not be read this time; they are picked up by the next rebuild. */
  readonly skipped: readonly string[];
}

export interface MirrorIndex {
  /** Rebuilds the catalog from the mirror. Everything here is derived, so a full rebuild is the model. */
  rebuild(): RebuildResult;
  /** Stores a page's typed text so search can find it. Derivation produces the text; this keeps it. */
  recordPageText(documentId: string, pageNumber: number, text: string): void;
  listDocuments(): readonly IndexedDocument[];
  getDocument(documentId: string): IndexedDocument | null;
  search(query: string, options?: SearchOptions): readonly SearchHit[];
  openDocument(): OpenDocumentState;
  close(): void;
}

// The whole index is derived from the mirror, so a schema change just drops and rebuilds it.
const SCHEMA_VERSION = 1;

export function openMirrorIndex(mirrorRoot: string, options: MirrorIndexOptions = {}): MirrorIndex {
  const root = resolve(mirrorRoot);
  const derived = join(root, "derived");
  mkdirSync(derived, { recursive: true });
  const database = new Database(options.databasePath ?? join(derived, "index.sqlite"));
  database.pragma("journal_mode = WAL");
  applySchema(database);

  return {
    rebuild: () => rebuild(database, root),

    recordPageText: (documentId, pageNumber, text) => {
      database.prepare("DELETE FROM search WHERE document_id = ? AND page_number = ?").run(documentId, pageNumber);
      if (text.trim().length === 0) return;
      database.prepare("INSERT INTO search (document_id, page_number, text) VALUES (?, ?, ?)")
        .run(documentId, pageNumber, text);
    },

    listDocuments: () => database.prepare(`
      SELECT id, name, path, type, file_type AS fileType, parent_id AS parentId,
             page_count AS pageCount, modified_ms AS modifiedMs
      FROM documents WHERE deleted = 0 ORDER BY path
    `).all() as IndexedDocument[],

    getDocument: (documentId) => (database.prepare(`
      SELECT id, name, path, type, file_type AS fileType, parent_id AS parentId,
             page_count AS pageCount, modified_ms AS modifiedMs
      FROM documents WHERE id = ? AND deleted = 0
    `).get(documentId) as IndexedDocument | undefined) ?? null,

    search: (query, searchOptions = {}) => {
      const trimmed = query.trim();
      if (trimmed.length === 0) return [];
      return (database.prepare(`
        SELECT d.id, d.name, d.path, d.type, d.file_type AS fileType, d.parent_id AS parentId,
               d.page_count AS pageCount, d.modified_ms AS modifiedMs,
               s.page_number AS pageNumber, snippet(search, 2, '[', ']', '...', 12) AS excerpt
        FROM search s JOIN documents d ON d.id = s.document_id
        WHERE search MATCH ? AND d.deleted = 0
        ORDER BY rank LIMIT ?
      `).all(trimmed, searchOptions.limit ?? 20) as (IndexedDocument & {
        readonly pageNumber: number | null;
        readonly excerpt: string;
      })[]).map(({ pageNumber, excerpt, ...document }) => ({ document, pageNumber, excerpt }));
    },

    openDocument: () => (database.prepare(`
      SELECT document_id AS documentId, name, page_number AS pageNumber, last_sync_at AS lastSyncAt
      FROM open_document WHERE id = 1
    `).get() as OpenDocumentState | undefined)
      ?? { documentId: null, name: null, pageNumber: null, lastSyncAt: null },

    close: () => database.close(),
  };
}

function applySchema(database: Database.Database): void {
  const version = Number(database.pragma("user_version", { simple: true }));
  if (version !== 0 && version !== SCHEMA_VERSION) {
    database.exec("DROP TABLE IF EXISTS search; DROP TABLE IF EXISTS documents; DROP TABLE IF EXISTS open_document;");
    database.pragma("user_version = 0");
  }
  database.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      type TEXT NOT NULL,
      file_type TEXT,
      parent_id TEXT,
      page_count INTEGER NOT NULL DEFAULT 0,
      modified_ms INTEGER,
      deleted INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS open_document (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      document_id TEXT,
      name TEXT,
      page_number INTEGER,
      last_sync_at TEXT
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS search USING fts5(
      document_id UNINDEXED,
      page_number UNINDEXED,
      text,
      tokenize = 'unicode61 remove_diacritics 2'
    );
  `);
  database.pragma(`user_version = ${SCHEMA_VERSION}`);
}

// A full rebuild inside one transaction, the model rmmirror proved: the mirror is the truth, the index
// is a projection of it, so nothing can drift apart. Page text is carried over from the previous rows,
// which is what lets a rebuild run without re-rendering anything.
function rebuild(database: Database.Database, mirrorRoot: string): RebuildResult {
  const { entries, skipped } = readMirrorEntries(mirrorRoot);
  const state = readMirrorState(mirrorRoot);
  const byId = new Map(entries.map(({ entry }) => [entry.id, entry]));

  const carriedText = database.prepare("SELECT document_id AS documentId, page_number AS pageNumber, text FROM search")
    .all() as { documentId: string; pageNumber: number | null; text: string }[];

  const apply = database.transaction(() => {
    database.exec("DELETE FROM documents; DELETE FROM search; DELETE FROM open_document;");
    const insertDocument = database.prepare(`
      INSERT INTO documents (id, name, path, type, file_type, parent_id, page_count, modified_ms, deleted)
      VALUES (@id, @name, @path, @type, @fileType, @parentId, @pageCount, @modifiedMs, @deleted)
    `);
    const insertSearch = database.prepare("INSERT INTO search (document_id, page_number, text) VALUES (?, ?, ?)");
    let documents = 0;
    let folders = 0;
    for (const { entry } of entries) {
      const folder = entry.type === "CollectionType";
      // Counted the way every read query sees the index: the trash is stored, but never returned, so
      // counting it here would report more documents than the tablet itself does.
      if (!entry.deleted) {
        if (folder) folders++;
        else documents++;
      }
      const path = pathOf(entry, byId);
      insertDocument.run({
        id: entry.id,
        name: entry.name,
        path,
        type: folder ? "folder" : "document",
        fileType: entry.fileType,
        parentId: entry.parentId,
        pageCount: entry.pages.length,
        modifiedMs: entry.modifiedMs,
        deleted: entry.deleted ? 1 : 0,
      });
      // The name and its folder path are searchable on their own, before any page text exists.
      insertSearch.run(entry.id, null, path);
      for (const carried of carriedText) {
        if (carried.documentId === entry.id && carried.pageNumber !== null) {
          insertSearch.run(carried.documentId, carried.pageNumber, carried.text);
        }
      }
    }
    const open = state.openDocumentId === null ? null : byId.get(state.openDocumentId) ?? null;
    database.prepare(`
      INSERT INTO open_document (id, document_id, name, page_number, last_sync_at) VALUES (1, ?, ?, ?, ?)
    `).run(state.openDocumentId, open?.name ?? null, state.openDocumentPageNumber, state.finishedAt);
    return { documents, folders };
  });

  const counts = apply();
  return { ...counts, skipped };
}
