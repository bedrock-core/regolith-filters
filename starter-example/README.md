# starter-example

A minimal Minecraft Bedrock addon demonstrating both generator template patterns from the [`generator`](../generator/README.md) filter.

## What it shows

| Pattern | File | Output |
|---------|------|--------|
| **Single-file** | `packs/BP/blocks/multiple.block.ts` | One `.json` file per default export object |
| **Multi-file** | `packs/BP/entities/single.entity.ts` | Multiple `.json` files from a `[nameFn, dataFn, items]` tuple |

## Running it

```bash
cd starter-example
yarn install
yarn regolith-install   # installs bundler + generator filters
yarn build              # runs Regolith and compiles the addon
```

Regolith writes built output to `.regolith/tmp/` and deploys to the `build/` folder.

See the [generator README](../generator/README.md) for full template syntax documentation.
