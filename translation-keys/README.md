# Translation Keys

A Regolith filter that generates a JSON mapping of translation keys to their resolved display strings, covering vanilla Minecraft text and your own pack strings — for one or more locales.

## Overview

The `@bedrock-core/ui` serialization protocol has an 80-byte limit on string fields. Longer strings must use Minecraft's localization key system instead — the key is serialized (it's always short) and the RP's `localize: true` setting resolves it at display time.

This filter produces `data/translation-keys/translationKeys.generated.json` at build time so the ui-runtime can look up the full display string for layout calculations (word-wrap, ellipsis, `measureText`).

The output is nested by locale (`{ "en_US": { ... }, "es_ES": { ... } }`) — Bedrock script bundles are static (no dynamic per-player import), so every configured locale's map ships in the one generated module, and your script picks the right sub-map per player at render time with `resolveTranslationKeysForPlayer` (keyed off `player.clientSystemInfo.locale`).

Per locale, merge order (later entries override earlier ones):

1. **Vanilla** — fetched from Mojang's official `bedrock-samples` GitHub (cached locally)
2. **RP lang** — `RP/texts/<locale>.lang` from your pack
3. **BP lang** — `BP/texts/<locale>.lang` from your pack

## Installation

```bash
regolith install github.com/bedrock-core/regolith-filters/translation-keys
```

Then add it to your `config.json` **before** the `bundler` filter:

```jsonc
{
  "regolith": {
    "filterDefinitions": {
      "translation-keys": {
        "url": "github.com/bedrock-core/regolith-filters/translation-keys",
        "version": "1.0.0"
      }
    },
    "profiles": {
      "default": {
        "filters": [
          { "filter": "translation-keys" },
          { "filter": "bundler" }
        ]
      }
    }
  }
}
```

## Usage in addon scripts

Import the generated (per-locale) map, resolve the connecting player's locale with
`resolveTranslationKeysForPlayer`, and provide the result at the root of your UI with
`TranslationKeysContext`:

```tsx
import allTranslationKeys from '@bedrock-core/generated/translation-keys';
import { resolveTranslationKeysForPlayer, TranslationKeysContext, usePlayer } from '@bedrock-core/ui';

export function App(): JSX.Element {
  const player = usePlayer();
  const translationKeys = resolveTranslationKeysForPlayer(allTranslationKeys, player);

  return (
    <TranslationKeysContext value={translationKeys ?? null}>
      <MyScreen />
    </TranslationKeysContext>
  );
}
```

`resolveTranslationKeysForPlayer` reads `player.clientSystemInfo.locale` and looks up that
locale in the generated map, falling back to `defaultLocale` (default `'en_US'`, pass a third
argument to change it) and then to any locale present — so a player on a language your addon
doesn't author content for still gets *some* metrics map instead of `undefined`.

`Text` with a `localizationKey` prop then resolves through the provided map:

```tsx
// Instead of this (throws SerializationError — exceeds 80 bytes):
<Text>Aliqua velit laborum ullamco dolor ullamco occaecat nisi labore cillum sint.</Text>

// Use this:
<Text localizationKey="ui.myscreen.description" />
```

Add the key to your pack's `.lang` file (e.g. `RP/texts/en_US.lang`):

```
ui.myscreen.description=Aliqua velit laborum ullamco dolor ullamco occaecat nisi labore cillum sint.
```

Short strings (under 80 UTF-8 bytes) can continue to use `children` as before — both forms are supported on the same `Text` component.

To override the translation data for a subtree (e.g. a different language or custom strings), nest another `TranslationKeysContext` with your own map:

```tsx
import { TranslationKeysContext } from '@bedrock-core/ui';
import myKeys from './myCustomKeys.json';

<TranslationKeysContext value={myKeys}>
  <MySubtree />
</TranslationKeysContext>
```

### TypeScript setup

On `regolith install`, the filter copies a `translationKeys.generated.d.ts` declaration into your project's `data/translation-keys/` folder. Commit this file — TypeScript uses it as a fallback before Regolith runs.

Add the following path alias to your `tsconfig.json` so TypeScript and the bundler resolve the `@bedrock-core/generated/translation-keys` import in your scripts:

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

## Runtime errors

If you use `localizationKey` without providing the context, or the key is missing from the generated map, the `Text` component throws a descriptive error at render time:

| Situation | Error |
|---|---|
| No `TranslationKeysContext` provider at the root | `TranslationKeysError: localizationKey requires translation keys, but no TranslationKeysContext is provided. Install the 'translation-keys' Regolith filter...` |
| Key not found in map | `TranslationKeysError: Cannot calculate layout for localizationKey "ui.foo" — no resolved string found...` |

Both errors are exported from `@bedrock-core/ui` as `TranslationKeysError` so you can catch them specifically.

## Settings

| Setting | Type | Default | Description |
|---|---|---|---|
| `locales` | `string[]` | `["en_US"]` | Locale codes to generate a translation map for. Each gets its own merged map, nested under its code in the output JSON. |
| `vanillaLangUrlTemplate` | `string` | Mojang bedrock-samples URL template | URL template to fetch each locale's vanilla `.lang` from — `{locale}` is replaced with the locale code |
| `cacheMaxAgeHours` | `number` | `24` | Hours before a locale's cached vanilla `.lang` is considered stale |
| `outputJsonPath` | `string` | `data/translation-keys/translationKeys.generated.json` | Output path for the JSON map (locale → key → string), relative to the Regolith temp directory |
| `langFilesTemplate` | `string[]` | `["RP/texts/{locale}.lang", "BP/texts/{locale}.lang"]` | Pack lang file path templates to merge on top of vanilla, in order, per locale — `{locale}` is replaced with the locale code |

Example with explicit settings:

```jsonc
{
  "filter": "translation-keys",
  "settings": {
    "locales": ["en_US", "es_ES"],
    "cacheMaxAgeHours": 48
  }
}
```

## Vanilla data cache

Vanilla lang content is fetched from GitHub and cached per locale at:

```
.regolith/cache/translation-keys/vanilla-<locale>.lang.cache
```

The cache lives in `.regolith/cache/` and is cleaned with `regolith clean`. Each locale's cache is refreshed independently when it is older than `cacheMaxAgeHours` (default: 24 hours).

## How it works

1. Regolith runs this filter inside its temp workspace and sets `ROOT_DIR` to your project root.
2. For each configured locale: the filter checks that locale's local cache. If missing or stale, it fetches vanilla `<locale>.lang` from `vanillaLangUrlTemplate` and writes the cache.
3. It reads and parses each file in `langFilesTemplate` (with `{locale}` filled in) from the temp workspace (if present), merging entries on top of that locale's vanilla set.
4. Each locale's merged map is sorted alphabetically by key for determinism; all locales are written together as one JSON object (`{ "<locale>": { ...map }, ... }`) to `outputJsonPath`.

## Troubleshooting

- **"ROOT_DIR environment variable not set"** — Run via Regolith; this filter relies on Regolith's environment.
- **"HTTP 4xx/5xx"** — Network issue fetching vanilla data for a locale. Check your connection or set `vanillaLangUrlTemplate` to a local mirror.
- **`TranslationKeysError` at render time** — Either the context is not provided or the key is missing. Check that the filter ran, that the key exists in a `.lang` file under `langFilesTemplate`, and that you resolved a locale with `resolveTranslationKeysForPlayer` before passing the map to `TranslationKeysContext`.
- **Key resolves to vanilla text unexpectedly** — Pack lang entries override vanilla (merge order: vanilla → RP → BP) per locale. Ensure your pack's `.lang` file for that locale is listed in `langFilesTemplate`.
- **A player sees the wrong locale's metrics** — `resolveTranslationKeysForPlayer` falls back to `defaultLocale` (then any locale present) when the player's own locale wasn't generated. Add it to `locales` if you author content for it.

## References

- [Minecraft Wiki — Language files](https://minecraft.wiki/w/Resource_pack#Language) — `.lang` file format
- [Mojang bedrock-samples — texts/](https://github.com/Mojang/bedrock-samples/tree/main/resource_pack/texts) — vanilla string source, per locale
- [@bedrock-core/ui — Text component](../../ui/packages/ui-runtime/src/components/Text.ts) — `localizationKey` prop
- [@bedrock-core/ui — TranslationKeys](../../ui/packages/ui-runtime/src/data/TranslationKeys.ts) — `resolveTranslationKeysForPlayer`

## Changelog

### 1.2.0 (breaking)

- **Multi-locale support.** `locales` (default `["en_US"]`) replaces the single hardcoded `en_US` — the filter fetches vanilla + merges pack `.lang` per configured locale.
- **Output shape changed**: `translationKeys.generated.json` is now nested by locale (`{ "en_US": { ... }, ... }`) instead of one flat map — Bedrock script bundles are static, so every configured locale ships in the one module. Use the new `resolveTranslationKeysForPlayer(byLocale, player, defaultLocale?)` helper (exported from `@bedrock-core/ui`) to pick the right sub-map per player before passing it to `TranslationKeysContext`.
- `vanillaLangUrl` → `vanillaLangUrlTemplate` (`{locale}` placeholder); `langFiles` → `langFilesTemplate` (`{locale}` placeholder). Vanilla cache is now per-locale (`vanilla-<locale>.lang.cache`).

### 1.1.0

- Translation keys are provided explicitly: import the generated module and wrap your UI root in `<TranslationKeysContext value={translationKeys}>`. The runtime does not import the generated module itself, so projects without this filter build and run fine — only using `localizationKey` without a provider throws.
- `TranslationKeysContext` can be nested to override the data for a subtree.

### 1.0.0

- Initial release
