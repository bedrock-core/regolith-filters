# Regolith Filters

This repository contains the @bedrock-core filters for the Regolith Addon Compiler.

You can add this repository as a regolith resolver by running

```bash
regolith config resolvers --append github.com/bedrock-core/regolith-filters/resolver.json
```

## Filters

| Filter | Description |
|--------|-------------|
| [**bundler**](./bundler/README.md) | Bundles TypeScript from `BP/scripts/` into a single `main.js` using esbuild. Respects `tsconfig.json`, marks Minecraft modules as external, and optionally emits source maps in debug mode. |
| [**generator**](./generator/README.md) | Transpiles `.ts` template files in `BP/` and `RP/` into JSON output files. Supports single-file and multi-file (array) generation patterns. |
| [**translation-keys**](./translation-keys/README.md) | Generates a JSON map of translation keys to resolved display strings by merging vanilla `en_US.lang` with your pack lang files. |

## Removed Filters

### item-aux (removed 2026-06-12)

**Reason:** There is no reliable runtime API in Minecraft Bedrock to determine custom item aux IDs in worlds with multiple addons. Item ID assignment depends on pack stack order at world load time, which is non-deterministic and cannot be known at build time or recovered at runtime. The runtime calibration approach via `ItemTypes.getAll()` also proved unreliable due to hash-order non-determinism and dev-build extras drift.

`ItemRenderer` still exists in `@bedrock-core/ui` but now requires you to manually supply an `ItemAuxMap` via `ItemAuxContext.Provider`. Item rendering is marked experimental. It works reliably only in single-addon worlds where aux IDs are deterministic.
