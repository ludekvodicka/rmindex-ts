# rmindex-ts

`rmindex-ts` turns a local reMarkable mirror into something you can search: a catalog of documents and
folders, full-text search over names, folder paths and typed text, and rendered page images.

It reads the mirror produced by
[`rmcommunication-ts`](https://github.com/ludekvodicka/rmcommunication-ts) `syncMirror`, which is also
its only peer dependency: scene parsing and rendering happen through that package, so this one never
holds a second copy of the scene library. It never talks to a tablet, opens no network connection,
needs no credentials, and writes nothing outside `<mirrorRoot>/derived/`.

## Install

```sh
npm install rmindex-ts rmcommunication-ts
```

Node 22 or newer, one major above its sisters: `better-sqlite3` 13 requires it. It ships prebuilt
binaries, so no compiler is needed.

## Use

```ts
import { openMirrorIndex } from "rmindex-ts";

const index = openMirrorIndex("./mirror");
try {
  for (const hit of index.search("architecture")) console.log(hit.document.path, hit.excerpt);
} finally {
  index.close();
}
```

## The four packages

| Package | What it does |
| --- | --- |
| [`rmscene-ts`](https://github.com/ludekvodicka/rmscene-ts) ([npm](https://www.npmjs.com/package/rmscene-ts)) | Reads, writes and renders `.rm` version 6 scene files. No filesystem, no network, browser-safe. |
| [`rmcommunication-ts`](https://github.com/ludekvodicka/rmcommunication-ts) ([npm](https://www.npmjs.com/package/rmcommunication-ts)) | Talks to the tablet over pinned SSH: listings, verified rmdoc backups, page rendering, templates, PNG, PDF and EPUB import, and the live mirror this package reads. |
| **`rmindex-ts`** (this package) | Turns that mirror into a catalog: SQLite index, FTS5 full-text search and a page-image cache. |
| [`remarkable-cli`](https://github.com/ludekvodicka/remarkable-cli) ([npm](https://www.npmjs.com/package/remarkable-cli)) | The `rmcli` command line over these libraries. |

None of them implements the reMarkable Cloud protocol.

## License

MIT.
