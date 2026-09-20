# @bedrock-core/regolith-filters_bundler

## 1.2.0

### Minor Changes

- [#1](https://github.com/bedrock-core/regolith-filters/pull/1) [`168059a`](https://github.com/bedrock-core/regolith-filters/commit/168059ad5e9b5e7ba5da808f59a0f6bdf98a3ea5) Thanks [@drav0011](https://github.com/drav0011)! - Screen modules are bundled with the same conditional rewrite the `ui-compiler` filter applies: `{cond && <X />}` becomes `<X visible={cond} />` and an element ternary becomes both branches with opposite visibility, so the tree the runtime walks has the shape the build baked.
  
  A pack with `*.screen.tsx` modules needs the `ui-compiler` filter installed beside `bundler`, which loads that rewrite from it; a pack without screens does not.

- [#1](https://github.com/bedrock-core/regolith-filters/pull/1) [`168059a`](https://github.com/bedrock-core/regolith-filters/commit/168059ad5e9b5e7ba5da808f59a0f6bdf98a3ea5) Thanks [@drav0011](https://github.com/drav0011)! - The filter runs its TypeScript source directly on Node 22.18 or newer; nothing is built. Regolith installs it with npm from the lockfile committed beside it, and it lays out every file it writes from the `pretty` setting: an object such as `{ "indent": "tab" }` indents, absent or `false` minifies.
