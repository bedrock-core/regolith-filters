# Generator

Write Minecraft JSON as TypeScript. The filter finds `.ts` files in your packs,
runs them, and writes the JSON next to them — one file, or many from a list.

Templates are checked against Mojang's official JSON Schemas as you type.

## Install

```bash
regolith install github.com/bedrock-core/regolith-filters/generator
```

```jsonc
{
  "regolith": {
    "filterDefinitions": {
      "generator": {
        "url": "github.com/bedrock-core/regolith-filters",
        "version": "1.1.0"
      }
    },
    "profiles": {
      "build": {
        "filters": [{ "filter": "generator" }]
      }
    }
  }
}
```

Then add the generated types to your `tsconfig.json`:

```jsonc
{
  "include": [
    "packs/data/generated/mc/globals.d.ts",
    "packs/BP/**/*.ts",
    "packs/RP/**/*.ts"
  ]
}
```

Run the build once — the types are written on the first run.

## One file

A default-exported object becomes one `.json` with the same basename.
`satisfies Entity` is what gives you autocompletion; it is erased at build time,
so nothing reaches the runtime.

```ts
// BP/entities/training_dummy.entity.ts  ->  training_dummy.entity.json
export default {
  format_version: '1.21.0',
  'minecraft:entity': {
    description: { identifier: 'example:training_dummy', is_summonable: true },
    components: {
      'minecraft:health': { value: 20, max: 20 },
      'minecraft:physics': {},
    },
  },
} satisfies Entity;
```

## Many files

Default-export `[nameFn, dataFn, items]`. `nameFn` returns a basename (`.json`
is added if missing); both callbacks may be `async`.

```ts
// BP/blocks/ores.ts  ->  ruby_ore.json, sapphire_ore.json
type Options = { id: string; mapColor: string; light?: number };

export default [
  (o) => `${o.id}.json`,
  (o) => ({
    format_version: '1.21.0',
    'minecraft:block': {
      description: { identifier: `example:${o.id}` },
      components: {
        'minecraft:map_color': o.mapColor,
        'minecraft:light_emission': o.light ?? 0,
      },
    },
  }),
  [
    { id: 'ruby_ore', mapColor: '#c0392b' },
    { id: 'sapphire_ore', mapColor: '#2980b9', light: 7 },
  ],
] satisfies Many<Options, Block>;
```

Naming `Options` once in the `satisfies` types both callbacks, so `o` needs no
annotation.

## The type names

One global per document category, no import needed. Press Ctrl+Space after
`satisfies ` to browse all 39:

`Block` `Entity` `Item` `Biome` `Feature` `FeatureRule` `LootTable` `Recipe`
`SpawnRule` `Trading` `Dialogue` `AnimationController` `VoxelShape` `Tick`
`Model` `Fog` `Particle` `Attachable` `RenderController` `Sound`
`BlocksResource` `TerrainTexture` `ItemTexture` `FlipbookTexture`
`BlockCulling` `Ui` `GlobalVariable` `TextureSet` `Language` `MusicDefinition`
`Lighting` `ColorGrading` `Atmospheric` `Pbr` `PointLight` `Shadow` `Water`

Two carry a pack prefix because the plain name was taken: `BpAnimation`
(TypeScript's DOM lib defines `Animation`) and `RpEntity`. If any of these clash
with your own globals, set `typePrefix` — `"Mc"` gives `McBlock`, `McEntity`, …

## Rules

- Templates live anywhere under BP/RP, **at any depth**.
  `BP/entities/mobs/hostile/zombie.ts` works; its JSON is written beside it. The
  type comes from `satisfies`, never from the folder.
- `BP/scripts/**` and `**/*.d.ts` are skipped.
- No `import`/`require` at runtime — templates are evaluated in a sandbox.
  `import type` is fine (esbuild erases it), so you can pull in type names
  directly: `import type { BlockBehaviorDocument } from '../../data/generated/mc'`.
- Pack folders come from `config.json` (`packs.behaviorPack` /
  `packs.resourcePack`), defaulting to `BP` and `RP`.

## Settings

| Setting | Default | What it does |
| --- | --- | --- |
| `include` | `BP/**/*.ts`, `RP/**/*.ts` | Globs to scan. String or array. |
| `exclude` | `BP/scripts/**`, `**/*.d.ts` | Globs to skip. |
| `pretty` | `true` | Indent the output JSON. |
| `types` | `true` | Generate the Minecraft types. `false` skips the download entirely. |
| `schemaVersion` | `"latest"` | Dist-tag (`latest`, `beta`) or exact version. Pin it for reproducible builds. |
| `typesDir` | `<dataPath>/generated/mc` | Where the types land, relative to project root. |
| `typePrefix` | `""` | Prefix for the global aliases. |
| `strict` | `false` | Reject properties the schema does not declare. |
| `maxAgeHours` | `24` | Registry metadata cache lifetime. Only used for dist-tags. |

## How it works

Regolith runs the filter in its temp workspace with `ROOT_DIR` pointing at your
project. The filter downloads [`@minecraft/bedrock-schemas`][pkg] (Mojang's
official schemas, MIT), caches it under `.regolith/cache/generator/`, and
compiles it into `.d.ts` files — skipped when the cached version already matches.
Then it scans for templates, transpiles each with esbuild, evaluates it in a
sandboxed VM, and writes the JSON.

The types are written to your real project, not the temp copy, because the IDE
is what reads them. They land outside `BP`/`RP`, so they never ship in your pack.
Commit them or gitignore them — either works.

[pkg]: https://www.npmjs.com/package/@minecraft/bedrock-schemas

### Accuracy

The schemas trail the game by a version or two, so `strict` is off by default.
Where a schema carries no usable information — a few components are published as
a bare `{"type": "object"}`, and entity `description` is undescribed — the type
is `unknown` rather than an invented shape, so valid templates never produce
false errors. Component *names* autocomplete everywhere; some *values* are
unconstrained.

## Troubleshooting

| Message | Fix |
| --- | --- |
| `ROOT_DIR environment variable not set` | Run through Regolith; the filter needs its environment. |
| `No .ts templates found` | Templates must be under BP/RP and not in `BP/scripts/`. |
| `Imports are not allowed in template files` | Drop the `import`/`require`, or make it `import type`. |
| `Invalid default export array` | The tuple must be exactly `[nameFn, dataFn, items]`. |
| `Invalid filename` | `nameFn` must return a non-empty basename, no directories. |
| `Cannot find name 'Block'` | `tsconfig.json` `include` is missing `packs/data/generated/mc/globals.d.ts`, or you have not run the build yet. |
| Types look stale | Bump `schemaVersion`, or delete `packs/data/generated/mc/`. |

## Changelog

### 1.1.0

- Type templates against the official Mojang JSON Schemas — 39 document
  categories, as global `Block` / `Entity` / `Item` / … aliases plus `Many`, so
  plain exports typecheck with no import
- Allow `import type` in templates
- Optional `defineTemplate` / `defineMany` helpers, for callers who would rather
  infer the item type than name it
- New settings: `types`, `schemaVersion`, `typesDir`, `typePrefix`, `strict`,
  `maxAgeHours`

### 1.0.0

- Initial release
