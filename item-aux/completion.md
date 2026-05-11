# Item Aux

A Regolith filter that generates `itemAuxMap.generated.json` — a mapping of item identifiers to their Bedrock Aux IDs — for use in addon scripts and JSON UI.

Combines:
- **Vanilla items** from Mojang's official `bedrock-samples` metadata (fetched once, cached locally)
- **Custom items** from your RP's `textures/item_texture.json` (non-`minecraft:` namespaced entries)

Aux formula: `aux = item_id << 16` (i.e., `item_id * 65536`)

Settings:

- `customStart` (integer|null, default `null`) — First item ID for custom items. When `null`, automatically set to `max(vanilla raw_id) + 1`
- `itemsUrl` (string) — URL for vanilla item metadata (defaults to Mojang's `bedrock-samples` on GitHub)
- `cacheMaxAgeHours` (number, default `24`) — How long to keep the cached vanilla data before re-fetching
- `outputPath` (string, default `BP/scripts/data/itemAuxMap.generated.json`) — Output path relative to the Regolith temp directory

## TypeScript setup

The generated JSON file should not be committed to version control (add it to `.gitignore`). To let TypeScript resolve the import before Regolith runs, create an ambient module declaration next to where you import the file:

**`BP/scripts/data/itemAuxMap.generated.d.ts`**

```ts
declare module '*/itemAuxMap.generated.json' {
	const value: Record<string, number>;
	export default value;
}
```

This file **should** be committed. TypeScript uses it as a fallback when the JSON doesn't exist yet (e.g. in CI or fresh checkouts). Once Regolith generates the real file, the bundler reads the actual JSON — the declaration only affects type-checking.
