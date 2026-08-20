# Changelog

## 0.1.0 - unreleased

- Opens a SQLite store under `<mirrorRoot>/derived/index.sqlite` over a local reMarkable mirror, with
  FTS5 full-text search tokenized as `unicode61 remove_diacritics 2` so Czech text matches without
  diacritics.
- Reads only the mirror: the package never opens a device or network connection and writes nothing
  outside `<mirrorRoot>/derived/`.
- Drops and recreates the store when its schema version moves, because everything in it is derivable.
