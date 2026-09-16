---
'@bedrock-core/regolith-filters_bundler': minor
---

Screen modules are bundled with the same conditional rewrite the `ui-compiler` filter applies: `{cond && <X />}` becomes `<X visible={cond} />` and an element ternary becomes both branches with opposite visibility, so the tree the runtime walks has the shape the build baked.
