# Generator

A Regolith filter for generating JSON files from TypeScript templates for Minecraft Bedrock Edition.

It scans your Behavior and Resource packs for `.ts` template files and writes `.json` files next to them. Supports:

- Single file: default export is an object → `<same-name>.json`
- Multiple files: default export is `[nameFn, dataFn, items]`

Templates are typed against the official Mojang JSON Schemas
(`@minecraft/bedrock-schemas`, 39 document categories). The filter compiles them
into `packs/data/generated/mc/` and declares a global alias per category, so
plain exports typecheck with no import and no helper call:

```ts
export default { /* ... */ } satisfies Block;
export default [nameFn, dataFn, items] satisfies Many<Options, Block>;
```

`Block`, `Entity`, `Item`, `BpAnimation`, `Particle`, … — type `Mc` and
press Ctrl+Space. `satisfies` is erased at build time. Optional
`defineTemplate` / `defineMany` helpers exist if you want the item type
inferred instead of naming it.

Add `packs/data/generated/mc/globals.d.ts` to your tsconfig `include`.

Notes:

- No runtime `import`/`require` inside templates (evaluated in a sandbox); `import type` is allowed
- BP/RP paths are resolved from `config.json` (defaults to `BP`/`RP`)
- Excludes `BP/scripts/**` and `**/*.d.ts` by default

Settings:

- `include` (string|string[]) — glob(s) for template discovery
- `exclude` (string|string[]) — glob(s) to ignore
- `pretty` (boolean, default true) — pretty-print output JSON
- `types` (boolean, default true) — generate the Minecraft schema types
- `schemaVersion` (string, default "latest") — dist-tag or exact schema package version
- `typesDir` (string) — where generated types land (default `<dataPath>/generated/mc`)
- `strict` (boolean, default false) — reject properties the schema does not declare
- `maxAgeHours` (number, default 24) — registry metadata cache lifetime
