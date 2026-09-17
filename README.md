# @bedrock-core/regolith-filters

The Regolith filter set behind `@bedrock-core` addons: `bundler`, `core`, `generator`, `guides`,
`i18n`, `manifest`, `ui-compiler`. An addon built on the framework — including `examples/` and a
project scaffolded by `@bedrock-core/cli` — runs these at build time to turn `@bedrock-core`
framework source into a shippable pack.

## Filters

| Filter | What it does |
|--------|-------------|
| [**core**](./core/README.md) | Runs the whole stack — `manifest`, `generator`, `guides`, `i18n`, `ui-compiler`, `bundler` — in that order, with settings shared across stages. |
| [**bundler**](./bundler/README.md) | Bundles TypeScript from `BP/scripts/` into a single `main.js` with esbuild. |
| [**generator**](./generator/README.md) | Writes Minecraft JSON from `.ts` templates, typed against Mojang's official JSON Schemas. |
| [**guides**](./guides/README.md) | Compiles MDX guide content into a guide manifest and auto-localized `.lang` entries for `@bedrock-core/guides`. |
| [**i18n**](./i18n/README.md) | Compiles nested TypeScript translation resources into `.lang` files, a runtime bundle, and typed key trees. |
| [**manifest**](./manifest/README.md) | Selects a manifest variant per profile and resolves its `extends` chain. |
| [**ui-compiler**](./ui-compiler/README.md) | Compiles screens written in JSX into static JSON UI. |

Most projects list only `core` in their profile, since it runs the other six in the order they
depend on and passes settings down to each one.

## Using these filters

```bash
regolith config resolvers --append github.com/bedrock-core/regolith-filters/resolver.json
regolith install core manifest generator guides i18n ui-compiler bundler
```

`regolith install` records the resolved version of each filter in the project's own
`config.json`; a filter stays pinned to that tag until the project re-installs it.

## Development

```bash
npm install                     # every filter's dependencies, through the root workspaces
npm run typecheck
npm test                        # guides, i18n and ui-compiler
npm test --workspace manifest
```

Filters run their TypeScript directly on Node; nothing is built. A project installs a filter by
running `npm i` in that filter's folder, so each filter commits its own `package-lock.json`.
Inside this repository a plain `npm install` in a filter folder writes the root lockfile
instead, so refresh the filter lockfiles with `npm run lock`.

## Releasing

A filter is released as the git tag `<filter>-<version>`, which is what Regolith installs.
Versions and changelogs come from changesets: `npm run changeset` records a change, a push to
`main` opens the Version PR, and running the Release workflow by hand on `main` tags every filter
whose version has no tag yet. Details in [`.changeset/README.md`](./.changeset/README.md).

## Documentation

https://bedrock-core.drav.dev/docs/filters
