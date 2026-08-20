import rmIndex = require("rmindex-ts");

const index: rmIndex.MirrorIndex = rmIndex.openMirrorIndex("./mirror");
const open: rmIndex.OpenDocumentState = index.openDocument();
index.close();
void open;
