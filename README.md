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
| [**item-aux**](./item-aux/README.md) | Generates a JSON map of item identifiers to Bedrock Aux IDs, covering vanilla and custom items/blocks, for use with `ItemRenderer`. |
| [**translation-keys**](./translation-keys/README.md) | Generates a JSON map of translation keys to resolved display strings by merging vanilla `en_US.lang` with your pack lang files. |
