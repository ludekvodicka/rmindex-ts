import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

import Database from "better-sqlite3";

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

export interface MirrorIndex {
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
