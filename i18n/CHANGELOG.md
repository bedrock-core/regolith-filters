# @bedrock-core/regolith-filters_i18n

## 1.2.0

### Minor Changes

- [#1](https://github.com/bedrock-core/regolith-filters/pull/1) [`168059a`](https://github.com/bedrock-core/regolith-filters/commit/168059ad5e9b5e7ba5da808f59a0f6bdf98a3ea5) Thanks [@drav0011](https://github.com/drav0011)! - The filter runs its TypeScript source directly on Node 22.18 or newer; nothing is built. Regolith installs it with npm from the lockfile committed beside it, and it lays out every file it writes from the `pretty` setting: an object such as `{ "indent": "tab" }` indents, absent or `false` minifies.

- [#1](https://github.com/bedrock-core/regolith-filters/pull/1) [`474555b`](https://github.com/bedrock-core/regolith-filters/commit/474555b4aa527392b33b81747ddd542849c2840d) Thanks [@drav0011](https://github.com/drav0011)! - **Breaking.** The behavior pack's `.lang` carries `pack.name` and `pack.description` only, copied from the addon's `meta.name` and `meta.description`. A manifest header points at those two keys, which is the only lookup Bedrock does for it; a BP manifest naming `<namespace>.meta.name` no longer resolves.
  
  A `vanilla` branch in the addon's own resources now overrides vanilla strings instead of failing the build. Each overridden key is written to the resource pack's `.lang` under its vanilla name, and the runtime bundle carries the replacement wherever it carries that vanilla string. With `vanilla` enabled, a key that no vanilla string has is reported.

- [#1](https://github.com/bedrock-core/regolith-filters/pull/1) [`168059a`](https://github.com/bedrock-core/regolith-filters/commit/168059ad5e9b5e7ba5da808f59a0f6bdf98a3ea5) Thanks [@drav0011](https://github.com/drav0011)! - `vanilla` defaults to `false`: the vanilla `.lang` files are fetched and diffed, and `vanilla.generated.d.ts` written, only when a project sets `vanilla: true`.
  
  A `.lang` value keeps its trailing spaces, so the runtime bundle matches what the client draws. The namespace-scan messages name the manifest they read. The `from-lang` converter is removed.
