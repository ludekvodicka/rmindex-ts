import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface FixtureDocument {
  readonly id: string;
  readonly name: string;
  readonly parentId?: string | null;
  readonly folder?: boolean;
  readonly deleted?: boolean;
  readonly pageIds?: readonly string[];
  readonly fileType?: string;
}

/** Builds the parts of a mirror this package reads: the xochitl bundle files and state.json. */
export function writeFixtureMirror(
  root: string,
  documents: readonly FixtureDocument[],
  state: { readonly finishedAt?: string; readonly openDocumentId?: string; readonly openPageNumber?: number } = {},
): void {
  const directory = join(root, "xochitl");
  mkdirSync(directory, { recursive: true });
  for (const document of documents) {
    writeFileSync(join(directory, `${document.id}.metadata`), JSON.stringify({
      visibleName: document.name,
      type: document.folder === true ? "CollectionType" : "DocumentType",
      parent: document.deleted === true ? "trash" : document.parentId ?? "",
      lastModified: "1700000000000",
    }));
    writeFileSync(join(directory, `${document.id}.content`), JSON.stringify({
      fileType: document.fileType ?? (document.folder === true ? undefined : "notebook"),
      cPages: { pages: (document.pageIds ?? []).map((id) => ({ id })) },
    }));
    for (const pageId of document.pageIds ?? []) {
      mkdirSync(join(directory, document.id), { recursive: true });
      writeFileSync(join(directory, document.id, `${pageId}.rm`), "not a real scene");
    }
  }
  writeFileSync(join(root, "state.json"), JSON.stringify({
    schemaVersion: 1,
    finishedAt: state.finishedAt ?? "2026-08-21T06:00:00.000Z",
    host: "memory-device",
    openDocument: {
      documentId: state.openDocumentId ?? null,
      pageNumber: state.openPageNumber ?? null,
    },
  }));
}

export function writeTornMetadata(root: string, id: string): void {
  writeFileSync(join(root, "xochitl", `${id}.metadata`), '{"visibleName":"Half w');
}
