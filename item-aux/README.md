# Item Aux

A Regolith filter that generates a JSON mapping of item identifiers to their Bedrock Aux IDs, covering both vanilla and custom items.

## Overview

Bedrock's JSON UI uses Aux IDs to render items. This filter produces `data/item-aux/itemAuxMap.generated.json` at build time so your addon scripts can look up any item's Aux ID without hardcoding values.

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

No wrapping required — once the filter is installed and the tsconfig path alias is configured, `render()` seeds `ItemAuxContext` automatically from the generated JSON (with runtime calibration applied). `ItemRenderer` just works.

To override the item aux data for a subtree (e.g. custom item data), wrap with `ItemAuxContext` directly:

```tsx
import { ItemAuxContext } from '@bedrock-core/ui';
import itemAuxData from '@bedrock-core/generated/item-aux';

<ItemAuxContext value={itemAuxData}>
  <MyInventory />
</ItemAuxContext>
```

### TypeScript setup

On `regolith install`, the filter copies an `itemAuxMap.generated.d.ts` declaration into your project's `data/item-aux/` folder. Commit this file — TypeScript uses it as a fallback before Regolith runs.

Add the following path alias to your `tsconfig.json` so TypeScript and the bundler resolve the `@bedrock-core/generated/item-aux` alias used internally by `ItemAuxProvider`:

```json
{
  "compilerOptions": {
    "paths": {
      "@bedrock-core/generated/item-aux": [
        "./packs/data/item-aux/itemAuxMap.generated.json"
      ]
    }
  }
}
```

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
| `outputPath` | `string` | `data/item-aux/itemAuxMap.generated.json` | Output path relative to the Regolith temp directory |
| `blockBaseOffset` | `number` | `8621` | Offset added to `\|minVanillaId\|` to compute the custom block base. Increase by N if custom blocks render at wrong IDs after loading a new pack that registers additional blocks before yours |
| `shiftThreshold` | `integer` | `632` | First `raw_id` that may be displaced by developer-build items absent from the public API. Used to compute `correctionBoundaryAux = (shiftThreshold + customItemCount) × 65536`, which is embedded in `itemAuxMap.generated.json`. At runtime `getCalibratedAuxMap` adds `extraCount × 65536` to all items with aux ≥ this boundary. `632` is the empirically-confirmed first affected raw_id. |

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
7. `correctionBoundaryAux = (shiftThreshold + customItemCount) × 65536` is computed and written into the output JSON alongside the item map. At runtime `getCalibratedAuxMap` uses this boundary to apply a correction of `+extraCount × 65536` to all items with aux ≥ the boundary.

### Runtime calibration

Developer builds of Bedrock sometimes include items that are absent from the public `bedrock-samples` API. These items occupy raw_id slots and displace all subsequent vanilla items. `render()` corrects for this automatically via `getCalibratedAuxMap` (exported from `@bedrock-core/ui`) when seeding `ItemAuxContext` at the render root:

1. On first render it calls `ItemTypes.getAll()` (from `@minecraft/server`).
2. It counts how many registered `minecraft:` items are **not** in the generated map — these are developer-only extras.
3. If the count is non-zero it adds `extraCount × 65536` to every item at or above `correctionBoundaryAux`.

On a normal public build the extra count is 0 and the map is returned unchanged. No configuration is required.

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
- [Bedrock Add-Ons Discord server, msg by yasser444](https://discord.com/channels/523663022053392405/1067870274894172260/1402731495944359999) — how to get aux id of custom blocks

## Changelog

### 1.3.0

- Added `shiftThreshold` setting (default `632`) and `correctionBoundaryAux` output field to `itemAuxMap.generated.json`. `correctionBoundaryAux` is the lowest aux value that belongs to a vanilla item that may be displaced by developer-build extras, computed as `(shiftThreshold + customItemCount) × 65536`.
- Runtime calibration logic (`getCalibratedAuxMap`) ships as part of `@bedrock-core/ui-runtime` and runs automatically at the render root — it detects developer-build extra items via `ItemTypes.getAll()` and applies a correction of `+N × 65536` to all items with aux ≥ `correctionBoundaryAux`, where N is the count of detected extras. Normal/public builds are unaffected (correction is 0).

### 1.2.0

- Added custom block support: reads non-`minecraft:` keys from `RP/textures/terrain_texture.json`, sorts them in **reverse alphabetical order**, and assigns IDs `-(customBlockBase + i)`. Block base is computed dynamically as `|minVanillaId| + blockBaseOffset` (default `8621`). This matches the empirically confirmed order Bedrock assigns internal block IDs.

### 1.1.0

- Fixed custom item ID assignment: new-format items (1.16.100+) now correctly use IDs starting at 257 (not 256), matching Bedrock's runtime behaviour. Previously used negative IDs which mapped to vanilla blocks instead of custom textures.

### 1.0.0

- Initial release
