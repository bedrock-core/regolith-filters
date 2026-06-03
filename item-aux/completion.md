# Item Aux

A Regolith filter that generates `itemAuxMap.generated.json` — a mapping of item identifiers to their Bedrock Aux IDs — for use in addon scripts and JSON UI.

Combines:
- **Vanilla items** from Mojang's official `bedrock-samples` metadata (fetched once, cached locally)
- **Custom items** from your RP's `textures/item_texture.json` (non-`minecraft:` namespaced entries, sorted alphabetically)
- **Custom blocks** from your RP's `textures/terrain_texture.json` (non-`minecraft:` namespaced entries, sorted reverse-alphabetically)

Output: `data/item-aux/itemAuxMap.generated.json`

Aux formula: `aux = item_id << 16` (i.e., `item_id * 65536`)

| Category | `item_id` |
|---|---|
| Vanilla block/item (`raw_id < 256`) | `raw_id` |
| Vanilla item (`raw_id ≥ 256`) | `raw_id + customItemCount` |
| Custom item (new format, 1.16.100+) | `257 + alphabetical_index` |
| Custom block | `-(|minVanillaId| + blockBaseOffset + reverse_alpha_index)` |

Settings:

- `itemsUrl` (string) — URL for vanilla item metadata (defaults to Mojang's `bedrock-samples` on GitHub)
- `cacheMaxAgeHours` (number, default `24`) — How long to keep the cached vanilla data before re-fetching
- `outputPath` (string, default `data/item-aux/itemAuxMap.generated.json`) — Output path relative to the Regolith temp directory
- `blockBaseOffset` (number, default `8621`) — Offset added to `|minVanillaId|` to compute the custom block base. Increase by N if custom blocks render at wrong slots after loading a pack that registers additional blocks before yours
- `shiftThreshold` (integer, default `632`) — First `raw_id` affected by developer-build displacement; items at or above this threshold are corrected at runtime

## Usage

Wrap your UI root with `ItemAuxProvider` — no props needed, data is loaded and calibrated automatically:

```tsx
import { ItemAuxProvider } from '@bedrock-core/ui';

render(
  <ItemAuxProvider>
    <MyInventory />
  </ItemAuxProvider>,
  player,
);
```

Pass `data` explicitly to override the default source:

```tsx
import itemAuxData from '@bedrock-core/generated/item-aux';

<ItemAuxProvider data={itemAuxData}>
  <MyInventory />
</ItemAuxProvider>
```

## TypeScript setup

The filter copies an `itemAuxMap.generated.d.ts` type declaration into your project's `data/item-aux/` folder on `regolith install`. This file is committed to version control — TypeScript uses it as a fallback before Regolith runs.

Add the following path alias to your `tsconfig.json` so TypeScript and the bundler resolve the `@bedrock-core/generated/item-aux` alias:

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
