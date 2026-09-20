---
'@bedrock-core/regolith-filters_bundler': minor
'@bedrock-core/regolith-filters_generator': minor
'@bedrock-core/regolith-filters_guides': minor
'@bedrock-core/regolith-filters_i18n': minor
'@bedrock-core/regolith-filters_manifest': minor
---

The filter runs its TypeScript source directly on Node 22.18 or newer; nothing is built. Regolith installs it with npm from the lockfile committed beside it, and it lays out every file it writes from the `pretty` setting: an object such as `{ "indent": "tab" }` indents, absent or `false` minifies.
