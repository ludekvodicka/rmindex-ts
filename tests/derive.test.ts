import { mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { simpleTextDocument, writeBlocks } from "rmscene-ts";
import { afterEach, describe, expect, it } from "vitest";

import { derivePages, pageImagePath } from "../src/derive.js";
import { openMirrorIndex } from "../src/mirror-index.js";
import { writeFixtureMirror } from "./support/fixture-mirror.js";

const DOCUMENT_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) await rm(directory, { recursive: true, force: true });
});

describe("page derivation", () => {
  it("renders every page once and reuses the image while the source is unchanged", async () => {
    const root = await sceneMirror();

    const first = await derivePages(root);

    expect(first.failed).toEqual([]);
    expect(first.rendered).toHaveLength(1);
    expect(first.reused).toBe(0);
    const image = await readFile(pageImagePath(root, DOCUMENT_ID, 1));
    expect([...image.subarray(0, 8)]).toEqual(PNG_SIGNATURE);
    expect(image.byteLength).toBeGreaterThan(1000);
    expect(first.rendered[0]?.text).toContain("architecture sketch");
    expect(await readFile(join(root, "derived", "pages", DOCUMENT_ID, "1.txt"), "utf8")).toContain("architecture sketch");

    const second = await derivePages(root);
    expect(second.reused).toBe(1);
    expect(second.rendered[0]?.text).toContain("architecture sketch");
  });

  it("re-renders a page whose source moved, and everything under force", async () => {
    const root = await sceneMirror();
    await derivePages(root);
    const before = await stat(pageImagePath(root, DOCUMENT_ID, 1));

    const source = join(root, "xochitl", DOCUMENT_ID, "page-1.rm");
    const later = new Date(Date.now() + 5_000);
    await utimes(source, later, later);
    const changed = await derivePages(root);
    expect(changed.reused).toBe(0);
    expect((await stat(pageImagePath(root, DOCUMENT_ID, 1))).mtimeMs).toBeGreaterThanOrEqual(before.mtimeMs);

    const forced = await derivePages(root, { force: true });
    expect(forced.reused).toBe(0);
    expect(forced.rendered).toHaveLength(1);
  });

  it("collects a page that is not a readable scene and keeps going", async () => {
    const root = await temporaryRoot();
    writeFixtureMirror(root, [{ id: DOCUMENT_ID, name: "Poznámky", pageIds: ["page-1"] }]);

    const result = await derivePages(root);

    expect(result.rendered).toEqual([]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]).toContain("page-1");
    expect(existsSync(pageImagePath(root, DOCUMENT_ID, 1))).toBe(false);
  });

  it("refuses a document id that is not a single path segment", async () => {
    const root = await temporaryRoot();
    expect(() => pageImagePath(root, "../../etc", 1)).toThrow("Not a document id");
    expect(() => pageImagePath(root, DOCUMENT_ID, 0)).toThrow("Not a page number");
  });

  it("makes a page's typed text searchable through the index", async () => {
    const root = await sceneMirror();
    const derived = await derivePages(root);
    const index = openMirrorIndex(root);
    try {
      index.rebuild();
      for (const page of derived.rendered) index.recordPageText(page.documentId, page.pageNumber, page.text);

      const hits = index.search("architecture");
      expect(hits).toHaveLength(1);
      expect(hits[0]?.pageNumber).toBe(1);
      expect(hits[0]?.excerpt).toContain("[architecture]");
    } finally {
      index.close();
    }
  });
});

async function sceneMirror(): Promise<string> {
  const root = await temporaryRoot();
  writeFixtureMirror(root, [{ id: DOCUMENT_ID, name: "Poznámky", pageIds: ["page-1"] }]);
  const blocks = simpleTextDocument("architecture sketch", { version: "3.27.3.0" });
  await writeFile(join(root, "xochitl", DOCUMENT_ID, "page-1.rm"), writeBlocks(blocks, { version: "3.27.3.0" }));
  return root;
}

async function temporaryRoot(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "rmindex-derive-test-"));
  temporaryDirectories.push(directory);
  return join(directory, "mirror");
}
