import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openMirrorIndex } from "rmindex-ts";

const root = await mkdtemp(join(tmpdir(), "rmindex-esm-"));
const index = openMirrorIndex(root);
try {
  assert.equal(typeof index.search, "function");
  assert.deepEqual(index.listDocuments(), []);
} finally {
  index.close();
}
