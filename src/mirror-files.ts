import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { parseDocumentEntry, parseJsonObject, type DocumentEntry } from "rmcommunication-ts";

export interface MirrorEntry {
  readonly entry: DocumentEntry;
  /** Newest modification time seen on the entry's own files, used to detect what changed. */
  readonly sourceMtimeMs: number;
}

export interface MirrorReadResult {
  readonly entries: readonly MirrorEntry[];
  /** One line per document that could not be read; a torn file must not fail the whole rebuild. */
  readonly skipped: readonly string[];
}

export interface MirrorState {
  readonly finishedAt: string | null;
  readonly openDocumentId: string | null;
  readonly openDocumentPageNumber: number | null;
}

export function xochitlDirectory(mirrorRoot: string): string {
  return join(mirrorRoot, "xochitl");
}

// The tablet writes while we read, so a half-written .metadata or .content is normal. Such an entry is
// skipped and picked up by the next rebuild rather than failing this one.
export function readMirrorEntries(mirrorRoot: string): MirrorReadResult {
  const directory = xochitlDirectory(mirrorRoot);
  const entries: MirrorEntry[] = [];
  const skipped: string[] = [];
  for (const name of listNames(directory)) {
    if (!name.endsWith(".metadata")) continue;
    const id = name.slice(0, -".metadata".length);
    try {
      const metadata = parseJsonObject(readFileSync(join(directory, name)), name);
      const contentName = `${id}.content`;
      const contentPath = join(directory, contentName);
      const content = existsSync(contentPath) ? parseJsonObject(readFileSync(contentPath), contentName) : {};
      entries.push({ entry: parseDocumentEntry(id, metadata, content), sourceMtimeMs: newestMtime(directory, id) });
    } catch (error) {
      skipped.push(`${id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { entries, skipped };
}

export function readMirrorState(mirrorRoot: string): MirrorState {
  try {
    const state = JSON.parse(readFileSync(join(mirrorRoot, "state.json"), "utf8")) as {
      finishedAt?: unknown;
      openDocument?: { documentId?: unknown; pageNumber?: unknown };
    };
    return {
      finishedAt: typeof state.finishedAt === "string" ? state.finishedAt : null,
      openDocumentId: typeof state.openDocument?.documentId === "string" ? state.openDocument.documentId : null,
      openDocumentPageNumber: typeof state.openDocument?.pageNumber === "number" ? state.openDocument.pageNumber : null,
    };
  } catch {
    return { finishedAt: null, openDocumentId: null, openDocumentPageNumber: null };
  }
}

/** Folder path of an entry, "Work/Projects/Notebook". A parent cycle stops at the entry itself. */
export function pathOf(entry: DocumentEntry, byId: ReadonlyMap<string, DocumentEntry>): string {
  const segments = [entry.name];
  const seen = new Set([entry.id]);
  let parentId = entry.parentId;
  while (parentId !== null && !seen.has(parentId)) {
    seen.add(parentId);
    const parent = byId.get(parentId);
    if (parent === undefined) break;
    segments.unshift(parent.name);
    parentId = parent.parentId;
  }
  return segments.join("/");
}

function newestMtime(directory: string, id: string): number {
  let newest = 0;
  for (const name of listNames(directory)) {
    if (!name.startsWith(id)) continue;
    try {
      const { mtimeMs } = statSync(join(directory, name));
      if (mtimeMs > newest) newest = mtimeMs;
    } catch {
      continue;
    }
  }
  return newest;
}

function listNames(directory: string): readonly string[] {
  try {
    return readdirSync(directory);
  } catch {
    return [];
  }
}
