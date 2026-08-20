const assert = require("node:assert/strict");
const { mkdtempSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const { openMirrorIndex } = require("rmindex-ts");

const root = mkdtempSync(join(tmpdir(), "rmindex-cjs-"));
const index = openMirrorIndex(root);
try {
  assert.equal(typeof index.search, "function");
  assert.deepEqual(index.listDocuments(), []);
} finally {
  index.close();
}
