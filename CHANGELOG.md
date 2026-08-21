# Changelog

## 0.1.1 - 2026-08-21

- Counts documents and folders the way every read query sees the index. The trash is stored but never
  returned, so a rebuild used to report more documents than the tablet holds.
- Requires `rmcommunication-ts` 0.2.2, which renders pages that are far taller than a sheet. Before it,
  every page of a long scrolled note failed to render with `Input image exceeds pixel limit`.

## 0.1.0 - 2026-08-21

- Opens a SQLite store under `<mirrorRoot>/derived/index.sqlite` over a local reMarkable mirror, with
  FTS5 full-text search tokenized as `unicode61 remove_diacritics 2` so Czech text matches without
  diacritics.
- Reads only the mirror: the package never opens a device or network connection and writes nothing
  outside `<mirrorRoot>/derived/`.
- Drops and recreates the store when its schema version moves, because everything in it is derivable.
- Rebuilds the catalog and full-text search from the mirror in one transaction, tolerating a document
  whose files were torn mid-sync.
- Renders changed pages to PNG with their template background and extracts typed text beside them,
  skipping pages whose cached image is already current.
- Takes `rmcommunication-ts` as its only peer: scene parsing, rendering and text extraction go through
  that package, so a consumer never ends up with two copies of the scene library.
