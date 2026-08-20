import { openMirrorIndex, type IndexedDocument, type MirrorIndex, type SearchHit } from "rmindex-ts";

const index: MirrorIndex = openMirrorIndex("./mirror");
const documents: readonly IndexedDocument[] = index.listDocuments();
const hits: readonly SearchHit[] = index.search("query", { limit: 5 });
index.close();
void documents;
void hits;
