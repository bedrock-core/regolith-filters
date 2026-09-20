# @bedrock-core/regolith-filters_manifest

## 2.0.0

### Major Changes

- [#1](https://github.com/bedrock-core/regolith-filters/pull/1) [`168059a`](https://github.com/bedrock-core/regolith-filters/commit/168059ad5e9b5e7ba5da808f59a0f6bdf98a3ea5) Thanks [@drav0011](https://github.com/drav0011)! - A resolved manifest must be `format_version` 3. Every version is a SemVer string (`header.version`, `header.min_engine_version`, `header.base_game_version`, and each module and dependency version) and `metadata.authors` is a non-empty array of strings. A manifest that breaks any of these fails the build with the path that broke it.

### Minor Changes

- [#1](https://github.com/bedrock-core/regolith-filters/pull/1) [`168059a`](https://github.com/bedrock-core/regolith-filters/commit/168059ad5e9b5e7ba5da808f59a0f6bdf98a3ea5) Thanks [@drav0011](https://github.com/drav0011)! - The filter runs its TypeScript source directly on Node 22.18 or newer; nothing is built. Regolith installs it with npm from the lockfile committed beside it, and it lays out every file it writes from the `pretty` setting: an object such as `{ "indent": "tab" }` indents, absent or `false` minifies.
