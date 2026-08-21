import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import Database from "better-sqlite3";

import { openMirrorIndex } from "../src/mirror-index.js";
import { writeFixtureMirror, writeTornMetadata } from "./support/fixture-mirror.js";

const DOCUMENT_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const FOLDER_ID = "dddddddd-eeee-4fff-8aaa-bbbbbbbbbbbb";
const OTHER_ID = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) await rm(directory, { recursive: true, force: true });
});

describe("mirror index store", () => {
  it("creates the database under the mirror's derived directory and starts empty", async () => {
    const root = await temporaryRoot();
    const index = openMirrorIndex(root);
    try {
      expect(existsSync(join(root, "derived", "index.sqlite"))).toBe(true);
      expect(index.listDocuments()).toEqual([]);
      expect(index.getDocument("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee")).toBeNull();
      expect(index.search("anything")).toEqual([]);
      expect(index.openDocument()).toEqual({ documentId: null, name: null, pageNumber: null, lastSyncAt: null });
    } finally {
      index.close();
    }
  });

  it("searches Czech text without diacritics, which is what the tokenizer is for", async () => {
    const root = await temporaryRoot();
    openMirrorIndex(root).close();

    // The rebuild that fills these tables lands in the next unit; writing them directly here proves
    // FTS5 is compiled in and tokenizes the way the schema asks.
    const database = openDatabase(root);
    database.prepare("INSERT INTO documents (id, name, path, type, file_type, parent_id, page_count, modified_ms) VALUES (?,?,?,?,?,?,?,?)")
      .run("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", "Poznámky", "Práce/Poznámky", "document", "notebook", null, 2, 1_700_000_000_000);
    database.prepare("INSERT INTO search (document_id, page_number, text) VALUES (?,?,?)")
      .run("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", 1, "příliš žluťoučký kůň úpěl ďábelské ódy");
    database.close();

    const index = openMirrorIndex(root);
    try {
      const hits = index.search("zlutoucky");
      expect(hits).toHaveLength(1);
      expect(hits[0]?.document.name).toBe("Poznámky");
      expect(hits[0]?.document.path).toBe("Práce/Poznámky");
      expect(hits[0]?.pageNumber).toBe(1);
      expect(hits[0]?.excerpt).toContain("[žluťoučký]");
    } finally {
      index.close();
    }
  });

  it("indexes documents, folders and nested paths from the mirror", async () => {
    const root = await temporaryRoot();
    writeFixtureMirror(root, [
      { id: FOLDER_ID, name: "Práce", folder: true },
      { id: DOCUMENT_ID, name: "Poznámky", parentId: FOLDER_ID, pageIds: ["page-1", "page-2"] },
      { id: OTHER_ID, name: "Koš", deleted: true },
    ], { openDocumentId: DOCUMENT_ID, openPageNumber: 2 });
    const index = openMirrorIndex(root);
    try {
      const result = index.rebuild();

      expect(result).toMatchObject({ documents: 2, folders: 1, skipped: [] });
      expect(index.listDocuments().map((document) => document.path)).toEqual(["Práce", "Práce/Poznámky"]);
      expect(index.getDocument(DOCUMENT_ID)).toMatchObject({
        name: "Poznámky",
        path: "Práce/Poznámky",
        type: "document",
        fileType: "notebook",
        pageCount: 2,
        parentId: FOLDER_ID,
      });
      expect(index.getDocument(OTHER_ID)).toBeNull();
      expect(index.openDocument()).toEqual({
        documentId: DOCUMENT_ID,
        name: "Poznámky",
        pageNumber: 2,
        lastSyncAt: "2026-08-21T06:00:00.000Z",
      });
    } finally {
      index.close();
    }
  });

  it("finds a document by its name and by its folder path, diacritics or not", async () => {
    const root = await temporaryRoot();
    writeFixtureMirror(root, [
      { id: FOLDER_ID, name: "Práce", folder: true },
      { id: DOCUMENT_ID, name: "Poznámky", parentId: FOLDER_ID },
    ]);
    const index = openMirrorIndex(root);
    try {
      index.rebuild();

      expect(index.search("poznamky").map((hit) => hit.document.id)).toEqual([DOCUMENT_ID]);
      expect(index.search("prace").map((hit) => hit.document.id).sort()).toEqual([DOCUMENT_ID, FOLDER_ID].sort());
      expect(index.search("   ")).toEqual([]);
      expect(index.search("nothinghere")).toEqual([]);
    } finally {
      index.close();
    }
  });

  it("skips a document whose metadata is torn and still finishes the rebuild", async () => {
    const root = await temporaryRoot();
    writeFixtureMirror(root, [{ id: DOCUMENT_ID, name: "Poznámky" }, { id: OTHER_ID, name: "Notes" }]);
    writeTornMetadata(root, OTHER_ID);
    const index = openMirrorIndex(root);
    try {
      const result = index.rebuild();

      expect(result.documents).toBe(1);
      expect(result.skipped).toHaveLength(1);
      expect(result.skipped[0]).toContain(OTHER_ID);
      expect(index.listDocuments().map((document) => document.id)).toEqual([DOCUMENT_ID]);
    } finally {
      index.close();
    }
  });

  it("forgets a document that vanished from the mirror", async () => {
    const root = await temporaryRoot();
    writeFixtureMirror(root, [{ id: DOCUMENT_ID, name: "Poznámky" }, { id: OTHER_ID, name: "Notes" }]);
    const index = openMirrorIndex(root);
    try {
      index.rebuild();
      expect(index.listDocuments()).toHaveLength(2);

      await rm(join(root, "xochitl", `${OTHER_ID}.metadata`));
      index.rebuild();

      expect(index.listDocuments().map((document) => document.id)).toEqual([DOCUMENT_ID]);
      expect(index.search("notes")).toEqual([]);
    } finally {
      index.close();
    }
  });

  it("answers that nothing was synced yet when there is no state file", async () => {
    const root = await temporaryRoot();
    writeFixtureMirror(root, [{ id: DOCUMENT_ID, name: "Poznámky" }]);
    await rm(join(root, "state.json"));
    const index = openMirrorIndex(root);
    try {
      index.rebuild();
      expect(index.openDocument()).toEqual({ documentId: null, name: null, pageNumber: null, lastSyncAt: null });
    } finally {
      index.close();
    }
  });

  it("drops and recreates the store when the schema version moved", async () => {
    const root = await temporaryRoot();
    openMirrorIndex(root).close();
    const database = openDatabase(root);
    database.pragma("user_version = 99");
    database.close();

    const index = openMirrorIndex(root);
    try {
      expect(index.listDocuments()).toEqual([]);
    } finally {
      index.close();
    }
  });
});

function openDatabase(root: string) {
  return new Database(join(root, "derived", "index.sqlite"));
}

async function temporaryRoot(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "rmindex-test-"));
  temporaryDirectories.push(directory);
  return join(directory, "mirror");
}
