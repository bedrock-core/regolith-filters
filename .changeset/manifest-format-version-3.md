---
'@bedrock-core/regolith-filters_manifest': major
---

A resolved manifest must be `format_version` 3. Every version is a SemVer string (`header.version`, `header.min_engine_version`, `header.base_game_version`, and each module and dependency version) and `metadata.authors` is a non-empty array of strings. A manifest that breaks any of these fails the build with the path that broke it.
