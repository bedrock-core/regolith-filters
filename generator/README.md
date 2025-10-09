# Generator

A Regolith filter for generating JSON content from TypeScript templates for Minecraft Bedrock Edition.

## Overview

This filter scans your Behavior Pack (BP) and Resource Pack (RP) for TypeScript template files and generates JSON files alongside them. It supports:

- Single-file generation from a default-exported object
- Multi-file generation from a tuple pattern: `[nameFn, dataFn, items]`

It’s great for producing lots of similar content (blocks, entities, items, etc.) from concise, typed templates.

## Installation

Install the filter with Regolith:

```bash
regolith install github.com/bedrock-core/regolith-filters/generator
```

Then reference it in your project `config.json`:

```jsonc
{

  // ...
  "regolith": {
    "filterDefinitions": {
      "generator": {
        "url": "github.com/bedrock-core/regolith-filters/generator",
        "version": "1.0.0"
      }
    },
    "profiles": {
      "build": {
        "filters": [
          { "filter": "generator" }
        ]
      }
    }
  }
}
```

You can combine this with other filters (e.g., `bundler`). Since `generator` writes JSON next to your templates and ignores `BP/scripts`, order is typically flexible.

## Requirements and conventions

- Place template files anywhere under your BP or RP (default: `BP/**/*.ts`, `RP/**/*.ts`).
- Files in `BP/scripts/**` are ignored (that folder is for runtime scripts).
- Type definitions (`**/*.d.ts`) are ignored.
- Templates must not import or require other modules. The filter runs templates in a sandbox and will fail on `import` or `require()` usage.
- Output JSON is written next to the template file.
- Pack folders are resolved from your project `config.json` (`packs.behaviorPack` and `packs.resourcePack`). If missing, defaults are `BP` and `RP`.

## Template patterns

The filter supports two ways to describe generation:

1) Default-export a plain object (single file)

- The output file name matches the template file name, with `.json` extension.

Example (`BP/entities/single.entity.ts`):

```ts
export default {
  format_version: "1.21.0",
  "minecraft:entity": {
    description: {
      identifier: "example:training_dummy",
      is_summonable: true,
      is_spawnable: false,
      is_experimental: false
    },
    components: {
      "minecraft:health": { value: 20, max: 20 },
      "minecraft:nameable": {},
      "minecraft:collision_box": { width: 0.6, height: 1.8 },
      "minecraft:physics": {}
    }
  }
};
```

Generates: `BP/entities/single.entity.json`

2) Default-export a tuple `[nameFn, dataFn, items]` (multiple files)

- `nameFn(item)` → string filename (basename only; `.json` is appended if missing). May be async.
- `dataFn(item)` → object JSON data. May be async.
- `items` → array of parameters passed to the generators.

Example (`BP/blocks/multiple.block.ts`):

```ts
type Options = {
  id: string;
  displayName: string;
  mapColor: string;
  friction?: number;
  light?: number;
};

export default [
  (options: Options): string => `${options.id}.json`,
  (options: Options) => {
    const identifier = `example:${options.id}`;
    const friction = options.friction ?? 0.4;
    const light = options.light ?? 0;

    return {
      format_version: "1.21.0",
      "minecraft:block": {
        description: {
          identifier,
          properties: {},
        },
        components: {
          "minecraft:map_color": options.mapColor,
          "minecraft:display_name": options.displayName,
          "minecraft:destructible_by_mining": { seconds_to_destroy: 0.8 },
          "minecraft:friction": friction,
          "minecraft:light_emission": light,
        },
      },
    }
  },
  [
    { id: "tutorial_block", displayName: "Tutorial Block", mapColor: "#9acd32", friction: 0.6 },
    { id: "tutorial_block_red", displayName: "Tutorial Block (Red)", mapColor: "#c0392b" },
    { id: "tutorial_block_blue", displayName: "Tutorial Block (Blue)", mapColor: "#2980b9", light: 7 },
  ]
]
```

Generates: `BP/blocks/tutorial_block.json`, `BP/blocks/tutorial_block_red.json`, `BP/blocks/tutorial_block_blue.json`

Notes:

- Both `nameFn` and `dataFn` can be `async`.
- Filenames must be basenames only (no directories) and non-empty.
- If the filename doesn’t end in `.json`, the extension is added automatically.

## Settings

Optional settings can be passed via the Regolith filter settings:

```json
{
  "filter": "generator",
  "settings": {
    "pretty": true
  }
}
```

- `include` (string|string[]) — glob(s) to scan for `.ts` templates. Defaults to `BP/**/*.ts` and `RP/**/*.ts`. You can pass a string or an array. `packs/` prefix is normalized internally.
- `exclude` (string|string[]) — glob(s) to ignore. Defaults to `BP/scripts/**` and `**/*.d.ts`.
- `pretty` (boolean, default `true`) — pretty-print JSON with indentation. If `false`, outputs minified JSON.

Notes:

- BP/RP folders are auto-detected from `config.json` (falling back to `BP`/`RP`). If you don’t provide `include`/`exclude`, those defaults are used; if you do, your patterns are respected.
- The `BP/scripts/**` directory is excluded by default to avoid clashing with runtime script bundles.

## How it works

1. Regolith runs this filter inside its temp workspace and sets `ROOT_DIR` to your project root.
2. The filter reads `config.json` to locate your pack folders (defaults to `BP`/`RP` if not set).
3. It scans for `**/*.ts` files under those pack folders (excluding `BP/scripts/**` and `**/*.d.ts`).
4. Each template is transpiled with esbuild and evaluated in a sandboxed VM (no `require()` allowed).
5. Based on the export shape, it writes either one JSON file or many next to the template.

## Troubleshooting

- "ROOT_DIR environment variable not set" — Run via Regolith; this filter relies on Regolith’s environment.
- "No .ts templates found" — Ensure your templates are under your BP/RP folders (not in `BP/scripts/`) and have the `.ts` extension.
- "Imports are not allowed in template files" — Remove `import`/`require`. Templates must be self-contained.
- "Invalid default export array" — The tuple must be exactly `[nameFn, dataFn, items]`.
- "Invalid filename" — `nameFn` must return a non-empty basename (optionally ending with `.json`).
- Transpile/evaluation errors — Check TypeScript syntax and returned data shapes. The filter logs which file failed.

## Starter example

See `starter-example/` in this repository for a minimal project showing both single and multiple generation patterns.

## Changelog

### 1.0.0

- Initial release
