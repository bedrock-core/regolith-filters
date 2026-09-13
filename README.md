# Regolith Filters

This repository contains the @bedrock-core filters for the Regolith Addon Compiler.

You can add this repository as a regolith resolver by running

```bash
regolith config resolvers --append github.com/bedrock-core/regolith-filters/resolver.json
```

## Requirements

**Node.js 22.18 or newer.** Regolith runs the filters straight from TypeScript, so there is no
build step. `npm run typecheck` and `npm test` both run at the root.

Filters install with npm — Regolith runs `npm i` inside the filter folder and nothing else can
be substituted. So each filter commits its `package-lock.json`, and test-only dependencies live
at the root: Regolith installs a filter's `devDependencies` onto every consumer's machine.

## Filters

| Filter | Description |
|--------|-------------|
| [**core**](./core/README.md) | Runs the whole stack as one filter — manifest, guides, i18n, ui-compiler, bundler (and the generator on request) — in the order they depend on, with `namespace` declared once. |
| [**bundler**](./bundler/README.md) | Bundles TypeScript from `BP/scripts/` into a single `main.js` using esbuild. Respects `tsconfig.json`, marks Minecraft modules as external, and optionally emits source maps in debug mode. |
| [**generator**](./generator/README.md) | Transpiles `.ts` template files in `BP/` and `RP/` into JSON output files, typed against Mojang's official JSON Schemas. Supports single-file and multi-file (array) generation patterns. |
| [**guides**](./guides/README.md) | Compiles MDX guide content (`data/guides/<locale>/**`) into a guide IR manifest plus auto-localized `.lang` entries, rendered in-game by `@bedrock-core/guides`. Must run **before** i18n. |
| [**i18n**](./i18n/README.md) | TS-first localization: nested TypeScript resources become `.lang` files, a typed runtime bundle, and vanilla-key types — typed interpolation and plurals included. |
| [**manifest**](./manifest/README.md) | Picks the profile's manifest variant, resolves its `extends` chain into the canonical `manifest.json`, and deletes the variants so they never ship. |
| [**ui-compiler**](./ui-compiler/README.md) | Compiles container screens (`BP/scripts/**/*.screen.tsx`, JSX written with `@bedrock-core/ui`) into static JSON UI, routes the vanilla chest screen to them, and sizes the entity each one opens from. Must run **after** i18n and **before** bundler. |

Each filter's manual — settings, checks and worked examples — lives at
<https://bedrock-core.drav.dev/docs/filters>.
