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
| [**generator**](./generator/README.md) | Transpiles `.ts` template files in `BP/` and `RP/` into JSON output files, typed against Mojang's official JSON Schemas. Supports single-file and multi-file (array) generation patterns. |
| [**guides**](./guides/README.md) | Compiles MDX guide content (`data/guides/<locale>/**`) into a guide IR manifest plus auto-localized `.lang` entries, rendered in-game by `@bedrock-core/guides`. Must run **before** i18n. |
| [**i18n**](./i18n/README.md) | TS-first localization: nested TypeScript resources become `.lang` files, a typed runtime bundle, and vanilla-key types — typed interpolation and plurals included. |

## Removed Filters

### translation-keys (removed 2026-08-16)

**Reason:** superseded by [**i18n**](./i18n/README.md), which inverts the flow — nested TypeScript
resources are the source of truth and the `.lang` files, runtime bundle and key types are all
generated from them, with typed interpolation, plurals, library resources and vanilla keys on top.

Migration path and details: [translation-keys/README.md](./translation-keys/README.md) (the i18n
filter ships a `from-lang` tool). Pre-removal tags still resolve and install from this repository's
history.

### item-aux (removed 2026-06-12)

**Reason:** There is no reliable runtime API in Minecraft Bedrock to determine custom item aux IDs in worlds with multiple addons. Item ID assignment depends on pack stack order at world load time, which is non-deterministic and cannot be known at build time or recovered at runtime. The runtime calibration approach via `ItemTypes.getAll()` also proved unreliable due to hash-order non-determinism and dev-build extras drift.

`ItemRenderer` still exists in `@bedrock-core/ui` but now requires you to manually supply an `ItemAuxMap` via `ItemAuxContext.Provider`. Item rendering is marked experimental. It works reliably only in single-addon worlds where aux IDs are deterministic.
