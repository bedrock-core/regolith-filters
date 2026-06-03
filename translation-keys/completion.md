# Translation Keys

A Regolith filter that generates `translationKeys.generated.json` — a mapping of translation keys to their resolved display strings — for use in addon scripts.

Combines:
- **Vanilla strings** from Mojang's official `bedrock-samples` `en_US.lang` (fetched once, cached locally)
- **Pack strings** from your RP and BP `.lang` files (pack entries override vanilla)

Output: `data/translation-keys/translationKeys.generated.json`

Settings:

- `vanillaLangUrl` (string) — URL for the vanilla `en_US.lang` file (defaults to Mojang's `bedrock-samples` on GitHub)
- `cacheMaxAgeHours` (number, default `24`) — How long to keep the cached vanilla data before re-fetching
- `outputJsonPath` (string, default `data/translation-keys/translationKeys.generated.json`) — Output path for the JSON map, relative to the Regolith temp directory
- `langFiles` (string[], default `["RP/texts/en_US.lang", "BP/texts/en_US.lang"]`) — Pack lang files to merge on top of vanilla, in order

## Usage

Wrap your UI root with `TranslationKeysProvider` — no props needed, data is loaded automatically:

```tsx
import { TranslationKeysProvider } from '@bedrock-core/ui';

render(
  <TranslationKeysProvider>
    <MyScreen />
  </TranslationKeysProvider>,
  player,
);

// In your components:
<Text localizationKey="ui.myscreen.description" />
```

Pass `data` explicitly to override the default source:

```tsx
import translationKeys from '@bedrock-core/generated/translation-keys';

<TranslationKeysProvider data={translationKeys}>
  <MyScreen />
</TranslationKeysProvider>
```

## TypeScript setup

The filter copies a `translationKeys.generated.d.ts` type declaration into your project's `data/translation-keys/` folder on `regolith install`. This file is committed to version control — TypeScript uses it as a fallback before Regolith runs.

Add the following path alias to your `tsconfig.json` so TypeScript and the bundler resolve the `@bedrock-core/generated/translation-keys` alias:

```json
{
  "compilerOptions": {
    "paths": {
      "@bedrock-core/generated/translation-keys": [
        "./packs/data/translation-keys/translationKeys.generated.json"
      ]
    }
  }
}
```
