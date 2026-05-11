# Item Aux

A Regolith filter that generates a JSON mapping of item identifiers to their Bedrock Aux IDs, covering both vanilla and custom items.

## Overview

Bedrock's JSON UI uses Aux IDs to render items. This filter produces `BP/scripts/data/itemAuxMap.generated.json` at build time so your addon scripts can look up any item's Aux ID without hardcoding values.

Aux formula: `aux = item_id * 65536`

- **Vanilla items** — `item_id` = `raw_id` from Mojang's official `bedrock-samples` metadata
- **Custom items** — `item_id` = `customStart + alphabetical_index`, where identifiers come from your RP's `textures/item_texture.json` (non-`minecraft:` namespaced entries only, sorted alphabetically for deterministic assignment)

## Installation

```bash
regolith install github.com/bedrock-core/regolith-filters/item-aux
```

Then add it to your `config.json` **before** the `bundler` filter:

```jsonc
{
  "regolith": {
    "filterDefinitions": {
      "item-aux": {
        "url": "github.com/bedrock-core/regolith-filters/item-aux",
        "version": "1.0.0"
      }
    },
    "profiles": {
      "default": {
        "filters": [
          { "filter": "item-aux" },
          { "filter": "bundler" }
        ]
      }
    }
  }
}
```

## Usage in addon scripts

The generated file is a plain JSON object. Import it directly in TypeScript — esbuild bundles it into `main.js`:

```ts
import itemAuxMap from './data/itemAuxMap.generated.json';

const aux = itemAuxMap['minecraft:diamond_sword']; // → 184549376
const customAux = itemAuxMap['myaddon:cool_sword']; // → e.g. 54329344
```

For type safety, import the `ItemAuxMap` type from `@bedrock-core/ui`:

```ts
import type { ItemAuxMap } from '@bedrock-core/ui';
import rawMap from './data/itemAuxMap.generated.json';

const itemAuxMap = rawMap as ItemAuxMap;
```

### TypeScript ambient declaration

The generated JSON is not committed to version control, so TypeScript will error on the import in a fresh checkout or before the first Regolith run. Fix this by creating an ambient module declaration next to the import:

**`BP/scripts/data/itemAuxMap.generated.d.ts`**

```ts
declare module '*/itemAuxMap.generated.json' {
	const value: Record<string, number>;
	export default value;
}
```

Commit this file. TypeScript uses it as a fallback when the JSON doesn't exist yet; once Regolith generates the real file, the bundler reads the actual JSON.

## Custom items

Custom items are read from your RP's `textures/item_texture.json`. Any key in `texture_data` that contains `:` and does not start with `minecraft:` is treated as a custom item identifier.

Example `RP/textures/item_texture.json`:

```json
{
  "resource_pack_name": "my_addon",
  "texture_name": "atlas.items",
  "texture_data": {
    "myaddon:cool_sword": { "textures": "textures/items/cool_sword" },
    "myaddon:magic_wand": { "textures": "textures/items/magic_wand" }
  }
}
```

Custom identifiers are sorted **alphabetically** before ID assignment, so the mapping is deterministic regardless of declaration order. Given `customStart = 829`:

| Identifier | item_id | aux |
|---|---|---|
| `myaddon:cool_sword` | 829 | 54329344 |
| `myaddon:magic_wand` | 830 | 54394880 |

If `RP/textures/item_texture.json` is absent, the filter runs successfully with only vanilla items.

## Vanilla data cache

Vanilla item metadata is fetched from GitHub and cached at:

```
packs/data/item-aux/vanilla-items.cache.json
```

This file lives in your project source tree so it persists across Regolith runs. Add it to `.gitignore` if you don't want to commit it:

```
packs/data/item-aux/
```

The cache is refreshed when it is older than `cacheMaxAgeHours` (default: 24 hours).

## Settings

| Setting | Type | Default | Description |
|---|---|---|---|
| `customStart` | `integer \| null` | `null` | First item ID for custom items. When `null`, automatically derived as `max(vanilla raw_id) + 1` |
| `itemsUrl` | `string` | Mojang bedrock-samples URL | URL to fetch vanilla item metadata from |
| `cacheMaxAgeHours` | `number` | `24` | Hours before the vanilla cache is considered stale |
| `outputPath` | `string` | `BP/scripts/data/itemAuxMap.generated.json` | Output path relative to the Regolith temp directory |

Example with explicit settings:

```jsonc
{
  "filter": "item-aux",
  "settings": {
    "customStart": 829,
    "cacheMaxAgeHours": 48
  }
}
```

## How it works

1. Regolith runs this filter inside its temp workspace and sets `ROOT_DIR` to your project root.
2. The filter checks the local cache. If missing or stale, it fetches vanilla item metadata from `itemsUrl` and writes the cache.
3. It reads `RP/textures/item_texture.json` from the temp folder (if present) and collects non-`minecraft:` identifiers.
4. Custom identifiers are sorted alphabetically and assigned sequential IDs starting from `customStart`.
5. Vanilla and custom entries are merged and written to `outputPath`.

## Troubleshooting

- **"ROOT_DIR environment variable not set"** — Run via Regolith; this filter relies on Regolith's environment.
- **"HTTP 4xx/5xx"** — Network issue fetching vanilla data. Check your connection or provide a cached file manually.
- **"Unexpected JSON shape: expected a .data_items array"** — The fetched vanilla metadata doesn't match the expected Mojang format. Try updating `itemsUrl`.
- **Custom items missing** — Ensure `RP/textures/item_texture.json` exists and that custom keys use a non-`minecraft:` namespace (e.g., `myaddon:item_name`).
- **IDs shifting unexpectedly** — Custom IDs depend on alphabetical sort order. Never rename custom item identifiers without updating all references.

## References

- [bedrock-auxgen](https://github.com/DreamlandMC/bedrock-auxgen/) — Go CLI that inspired this filter's approach to vanilla + custom item aux generation
- [Bedrock Wiki — JSON UI: item-id-aux](https://wiki.bedrock.dev/json-ui/json-ui-documentation#item-id-aux-item-id-aux) — how aux IDs are used in JSON UI
- [Bedrock Wiki — Numerical Item IDs](https://wiki.bedrock.dev/items/numerical-item-ids) — ID ranges for vanilla, old-format, and new-format custom items
- [Mojang bedrock-samples — mojang-items.json](https://raw.githubusercontent.com/Mojang/bedrock-samples/refs/heads/main/metadata/vanilladata_modules/mojang-items.json) — official vanilla item metadata (source for `raw_id` values)

## Changelog

### 1.0.0

- Initial release
