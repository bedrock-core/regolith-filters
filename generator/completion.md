# Generator

A Regolith filter for generating JSON files from TypeScript templates for Minecraft Bedrock Edition.

It scans your Behavior and Resource packs for `.ts` template files and writes `.json` files next to them. Supports:

- Single file: default export is an object → `<same-name>.json`
- Multiple files: default export is `[nameFn, dataFn, items]`

Notes:

- No `import`/`require` inside templates (evaluated in a sandbox)
- BP/RP paths are resolved from `config.json` (defaults to `BP`/`RP`)
- Excludes `BP/scripts/**` and `**/*.d.ts` by default

Settings:

- `include` (string|string[]) — glob(s) for template discovery
- `exclude` (string|string[]) — glob(s) to ignore
- `pretty` (boolean, default true) — pretty-print output JSON
