import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import Database from "better-sqlite3";

import { openMirrorIndex } from "../src/mirror-index.js";

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
