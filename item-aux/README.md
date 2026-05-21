# Item Aux

A Regolith filter that generates a JSON mapping of item identifiers to their Bedrock Aux IDs, covering both vanilla and custom items.

## Overview

Bedrock's JSON UI uses Aux IDs to render items. This filter produces `BP/scripts/data/itemAuxMap.generated.json` at build time so your addon scripts can look up any item's Aux ID without hardcoding values.

Aux formula: `aux = item_id * 65536`

| Category | `item_id` |
|---|---|
| Vanilla block/item (`raw_id < 256`) | `raw_id` |
| Vanilla item (`raw_id ≥ 256`) | `raw_id + customItemCount` |
| Custom item (new format, 1.16.100+) | `257 + alphabetical_index` |
| Custom block | `-(customBlockBase + reverse_alpha_index)` |

New-format custom items occupy IDs 257 … 256+N (where N = number of custom items), pushing vanilla items that were ≥ 256 upward by N to make room. Identifiers come from your RP's `textures/item_texture.json` (non-`minecraft:` namespaced entries, sorted alphabetically for deterministic assignment).

Custom blocks use large negative IDs. The base is computed as `|minVanillaId| + blockBaseOffset` (default offset `8621`), where `minVanillaId` is the most-negative vanilla raw_id from the downloaded items data. This means the base auto-adjusts as Mojang adds new vanilla blocks — no manual recalibration needed across normal updates. Identifiers are read from `RP/textures/terrain_texture.json` (non-`minecraft:` namespaced keys) and sorted in **reverse alphabetical order** — this matches the order Bedrock assigns internal block IDs.

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

Custom identifiers are sorted **alphabetically** before ID assignment, so the mapping is deterministic regardless of declaration order. With 2 custom items:

| Identifier | item_id | aux |
|---|---|---|
| `myaddon:cool_sword` | 257 | 16842752 |
| `myaddon:magic_wand` | 258 | 16908288 |

If `RP/textures/item_texture.json` is absent, the filter runs successfully with only vanilla items.

## Vanilla data cache

Vanilla item metadata is fetched from GitHub and cached at:

```
.regolith/cache/item-aux/vanilla-items.cache.json
```

This lives inside the Regolith cache directory so it persists across runs and is cleaned by `regolith clean`. Add it to `.gitignore` if you prefer not to commit it:

```
.regolith/cache/item-aux/
```

The cache is refreshed when it is older than `cacheMaxAgeHours` (default: 24 hours).

## Settings

| Setting | Type | Default | Description |
|---|---|---|---|
| `itemsUrl` | `string` | Mojang bedrock-samples URL | URL to fetch vanilla item metadata from |
| `cacheMaxAgeHours` | `number` | `24` | Hours before the vanilla cache is considered stale |
| `outputPath` | `string` | `BP/scripts/data/itemAuxMap.generated.json` | Output path relative to the Regolith temp directory |
| `blockBaseOffset` | `number` | `8621` | Offset added to `\|minVanillaId\|` to compute the custom block base. Increase by N if custom blocks render at wrong IDs after loading a new pack that registers additional blocks before yours |

Example with explicit settings:

```jsonc
{
  "filter": "item-aux",
  "settings": {
    "cacheMaxAgeHours": 48
  }
}
```

## How it works

1. Regolith runs this filter inside its temp workspace and sets `ROOT_DIR` to your project root.
2. The filter checks the local cache. If missing or stale, it fetches vanilla item metadata from `itemsUrl` and writes the cache.
3. It reads `RP/textures/item_texture.json` from the temp folder (if present) and collects non-`minecraft:` identifiers.
4. Custom item identifiers are sorted alphabetically and assigned sequential IDs starting from 257.
5. It reads `RP/textures/terrain_texture.json` (if present), collects non-`minecraft:` namespaced keys, sorts them in **reverse alphabetical order**, and assigns large negative IDs starting at `-(customBlockBase)`.
6. Vanilla, custom item, and custom block entries are merged and written to `outputPath`.

## Troubleshooting

- **"ROOT_DIR environment variable not set"** — Run via Regolith; this filter relies on Regolith's environment.
- **"HTTP 4xx/5xx"** — Network issue fetching vanilla data. Check your connection or provide a cached file manually.
- **"Unexpected JSON shape: expected a .data_items array"** — The fetched vanilla metadata doesn't match the expected Mojang format. Try updating `itemsUrl`.
- **Custom items missing** — Ensure `RP/textures/item_texture.json` exists and that custom keys use a non-`minecraft:` namespace (e.g., `myaddon:item_name`).
- **IDs shifting unexpectedly** — Custom IDs depend on alphabetical sort order. Never rename custom item identifiers without updating all references.
- **Custom blocks render at wrong slot** — `blockBaseOffset` must account for blocks registered by other packs that load before yours. Increase it by the number of blocks those packs add. The filter log prints the computed `customBlockBase` to help diagnose this.

## References

- [bedrock-auxgen](https://github.com/DreamlandMC/bedrock-auxgen/) — Go CLI that inspired this filter's approach to vanilla + custom item aux generation
- [Bedrock Wiki — JSON UI: item-id-aux](https://wiki.bedrock.dev/json-ui/json-ui-documentation#item-id-aux-item-id-aux) — how aux IDs are used in JSON UI
- [Bedrock Wiki — Numerical Item IDs](https://wiki.bedrock.dev/items/numerical-item-ids) — ID ranges for vanilla, old-format, and new-format custom items
- [Mojang bedrock-samples — mojang-items.json](https://raw.githubusercontent.com/Mojang/bedrock-samples/refs/heads/main/metadata/vanilladata_modules/mojang-items.json) — official vanilla item metadata (source for `raw_id` values)

## Changelog

### 1.2.0

- Added custom block support: reads non-`minecraft:` keys from `RP/textures/terrain_texture.json`, sorts them in **reverse alphabetical order**, and assigns IDs `-(customBlockBase + i)`. Block base is computed dynamically as `|minVanillaId| + blockBaseOffset` (default `8621`). This matches the empirically confirmed order Bedrock assigns internal block IDs.

### 1.1.0

- Fixed custom item ID assignment: new-format items (1.16.100+) now correctly use IDs starting at 257 (not 256), matching Bedrock's runtime behaviour. Previously used negative IDs which mapped to vanilla blocks instead of custom textures.

### 1.0.0

- Initial release
