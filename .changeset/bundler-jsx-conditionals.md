---
'@bedrock-core/regolith-filters_bundler': minor
---

Screen modules are bundled with the same conditional rewrite the `ui-compiler` filter applies: `{cond && <X />}` becomes `<X visible={cond} />` and an element ternary becomes both branches with opposite visibility, so the tree the runtime walks has the shape the build baked.

A pack with `*.screen.tsx` modules needs the `ui-compiler` filter installed beside `bundler`, which loads that rewrite from it; a pack without screens does not.
