---
'@bedrock-core/regolith-filters_i18n': minor
---

`vanilla` defaults to `false`: the vanilla `.lang` files are fetched and diffed, and `vanilla.generated.d.ts` written, only when a project sets `vanilla: true`.

A `.lang` value keeps its trailing spaces, so the runtime bundle matches what the client draws. The namespace-scan messages name the manifest they read. The `from-lang` converter is removed.
