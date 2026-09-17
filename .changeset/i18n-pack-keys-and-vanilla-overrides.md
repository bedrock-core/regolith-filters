---
'@bedrock-core/regolith-filters_i18n': minor
---

**Breaking.** The behavior pack's `.lang` carries `pack.name` and `pack.description` only, copied from the addon's `meta.name` and `meta.description`. A manifest header points at those two keys, which is the only lookup Bedrock does for it; a BP manifest naming `<namespace>.meta.name` no longer resolves.

A `vanilla` branch in the addon's own resources now overrides vanilla strings instead of failing the build. Each overridden key is written to the resource pack's `.lang` under its vanilla name, and the runtime bundle carries the replacement wherever it carries that vanilla string. With `vanilla` enabled, a key that no vanilla string has is reported.
