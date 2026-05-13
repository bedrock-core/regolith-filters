# Translation Keys

A Regolith filter that generates `translationKeys.generated.json` — a mapping of translation keys to their resolved display strings — for use in addon scripts.

Combines:
- **Vanilla strings** from Mojang's official `bedrock-samples` `en_US.lang` (fetched once, cached locally)
- **Pack strings** from your RP and BP `.lang` files (pack entries override vanilla)

Settings:

- `vanillaLangUrl` (string) — URL for the vanilla `en_US.lang` file (defaults to Mojang's `bedrock-samples` on GitHub)
- `cacheMaxAgeHours` (number, default `24`) — How long to keep the cached vanilla data before re-fetching
- `outputJsonPath` (string, default `BP/scripts/data/translationKeys.generated.json`) — Output path for the JSON map, relative to the Regolith temp directory
- `langFiles` (string[], default `["RP/texts/en_US.lang", "BP/texts/en_US.lang"]`) — Pack lang files to merge on top of vanilla, in order

## TypeScript setup

The generated JSON file should not be committed to version control (add it to `.gitignore`). To let TypeScript resolve the import before Regolith runs, create an ambient module declaration next to where you import the file:

**`BP/scripts/data/translationKeys.generated.d.ts`**

```ts
declare module '*/translationKeys.generated.json' {
  const value: Record<string, string>;
  export default value;
}
```

This file **should** be committed. TypeScript uses it as a fallback when the JSON doesn't exist yet (e.g. in CI or fresh checkouts). Once Regolith generates the real file, the bundler reads the actual JSON — the declaration only affects type-checking.

## Usage

Wrap your UI root with `TranslationKeysContext` and use `localizationKey` on `Text` components for strings that exceed the 80-byte serialization limit:

```tsx
import translationKeys from './data/translationKeys.generated.json';
import { TranslationKeysContext } from '@bedrock-core/ui';

render(
  <TranslationKeysContext value={translationKeys}>
    <MyScreen />
  </TranslationKeysContext>,
  player,
);

// In your components:
<Text localizationKey="ui.myscreen.description" />
```
