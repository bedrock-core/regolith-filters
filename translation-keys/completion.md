# Translation Keys

A Regolith filter that generates `translationKeys.generated.json` — per locale, a mapping of
translation keys to their resolved display strings — for use in addon scripts.

Combines, per configured locale:
- **Vanilla strings** from Mojang's official `bedrock-samples` `<locale>.lang` (fetched once per locale, cached locally)
- **Pack strings** from your RP and BP `.lang` files for that locale (pack entries override vanilla)

Output: `data/translation-keys/translationKeys.generated.json`, written in Regolith's temp
workspace (never synced back to the project) — nested by locale:
`{ "en_US": { ... }, "es_ES": { ... } }`. Bedrock script bundles are static (no dynamic
per-player import), so every configured locale ships in the one module. The bundler resolves
the packs/data alias against the temp workspace and inlines the JSON — nothing generated
ever lands in the project source tree.

Settings:

- `locales` (string[], default `["en_US"]`) — Locale codes to generate a map for; each gets its own merged map
- `vanillaLangUrlTemplate` (string) — URL template for each locale's vanilla `.lang` file (`{locale}` placeholder; defaults to Mojang's `bedrock-samples` on GitHub)
- `cacheMaxAgeHours` (number, default `24`) — How long to keep a locale's cached vanilla data before re-fetching
- `outputJsonPath` (string, default `data/translation-keys/translationKeys.generated.json`) — Output path for the JSON map, relative to the Regolith temp directory
- `langFilesTemplate` (string[], default `["RP/texts/{locale}.lang", "BP/texts/{locale}.lang"]`) — Pack lang file templates to merge on top of vanilla, in order, per locale

## Usage

Resolve the connecting player's locale out of the generated (per-locale) map with
`resolveTranslationKeysForPlayer`, then provide it via `TranslationKeysContext`:

```tsx
import translationKeys from '@bedrock-core/generated/translation-keys';
import { resolveTranslationKeysForPlayer, TranslationKeysContext, usePlayer } from '@bedrock-core/ui';

function App(): JSX.Element {
  const player = usePlayer();

  return (
    <TranslationKeysContext value={resolveTranslationKeysForPlayer(translationKeys, player) ?? null}>
      <MyScreen />
    </TranslationKeysContext>
  );
}

// In your components:
<Text localizationKey="ui.myscreen.description" />
```

`resolveTranslationKeysForPlayer` reads `player.clientSystemInfo.locale`, falling back to
`defaultLocale` (default `'en_US'`) and then to any locale present in the map.

## TypeScript setup

The filter copies a `translationKeys.generated.d.ts` type declaration into your project's `data/translation-keys/` folder on `regolith install`. Commit this file — it is the only thing that lives there (the generated `.json` exists only in Regolith's temp workspace), and TypeScript uses it to type the module without ever running a build.

Add the following path alias to your `tsconfig.json` (and make sure `packs/data/**/*` is in `include` so the declaration loads):

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
