# The derived index

Status: decided
Date: 2026-08-21

## Decision

`rmindex-ts` turns a local mirror into a catalog, full-text search and page images. It is a separate
package because it is a third concern: `rmscene-ts` stays browser-safe with zero runtime dependencies,
`rmcommunication-ts` is the device package, and a local store with its own schema lifecycle belongs to
neither. Putting the store inside the device package would also hand its dependency to every consumer
that only transfers documents and never indexes anything.

Its one peer is `rmcommunication-ts`: scene parsing, rendering and text extraction happen through that
package's `renderPageBytes` and `readPageText`, so a consumer never ends up with two copies of the
scene library, which TypeScript would treat as two incompatible types anyway.

## What it must never do

Open a network or device connection, import `ssh2`, host a server, run a loop, or write anywhere except
`<mirrorRoot>/derived/`. The mirror itself, `xochitl/`, `templates/` and `state.json`, is read-only
input owned by `rmcommunication-ts`.

## Storage

`better-sqlite3` with FTS5, tokenized as `unicode61 remove_diacritics 2` so Czech text matches without
diacritics. Node's built-in `node:sqlite` was disqualified before its experimental status mattered: it
does not exist on Node 20, which the engines contract and the CI matrix require. `better-sqlite3` ships
prebuilt binaries for win32, linux, linuxmusl and darwin on both architectures, so no compiler and no
install script are involved.

## Rebuild model

The catalog is rebuilt in full from the mirror inside one transaction, which is what keeps it from
drifting: it is a projection of the files, not a second source of truth. Folder paths are computed with
cycle protection, deleted documents stay in the table but out of search, and a document whose
`.metadata` or `.content` was torn mid-sync is skipped with a note in `skipped` rather than failing the
rebuild. A schema version bump drops the store and recreates it, because everything in it is derivable.

## Page cache

A page is re-rendered when its `.rm` file is newer than the cached PNG, so the mirror's own modification
times are the whole invalidation story. Typed text is written next to the image as a `.txt` sidecar,
which is what lets a rebuilt catalog get its searchable text back without rendering anything again. Both
files are written to a temp and renamed, so a killed run never leaves a torn image. `force` re-renders
everything and is the recovery path for a cache anyone suspects. Deleting `derived/` is always safe.
