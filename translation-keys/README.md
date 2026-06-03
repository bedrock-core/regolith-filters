# Translation Keys

A Regolith filter that generates a JSON mapping of translation keys to their resolved display strings, covering vanilla Minecraft text and your own pack strings.

## Overview

The `@bedrock-core/ui` serialization protocol has an 80-byte limit on string fields. Longer strings must use Minecraft's localization key system instead — the key is serialized (it's always short) and the RP's `localize: true` setting resolves it at display time.

This filter produces `data/translation-keys/translationKeys.generated.json` at build time so the ui-runtime can look up the full display string for layout calculations (word-wrap, ellipsis, `measureText`).

Merge order (later entries override earlier ones):

1. **Vanilla** — fetched from Mojang's official `bedrock-samples` GitHub (cached locally)
2. **RP lang** — `RP/texts/en_US.lang` from your pack
3. **BP lang** — `BP/texts/en_US.lang` from your pack

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

No wrapping required — once the filter is installed and the tsconfig path alias is configured, `render()` seeds `TranslationKeysContext` automatically from the generated JSON. `Text` with a `localizationKey` prop just works:

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

To override the translation data for a subtree (e.g. a different language or custom strings), wrap with `TranslationKeysContext` directly:

```tsx
import { TranslationKeysContext } from '@bedrock-core/ui';
import myKeys from './myCustomKeys.json';

<TranslationKeysContext value={myKeys}>
  <MyScreen />
</TranslationKeysContext>
```

### TypeScript setup

On `regolith install`, the filter copies a `translationKeys.generated.d.ts` declaration into your project's `data/translation-keys/` folder. Commit this file — TypeScript uses it as a fallback before Regolith runs.

Add the following path alias to your `tsconfig.json` so TypeScript and the bundler resolve the `@bedrock-core/generated/translation-keys` alias used internally by the runtime:

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

If you use `localizationKey` and the generated JSON is missing (filter not installed or path alias not configured), or if the key is missing from the generated map, the `Text` component throws a descriptive error at render time:

| Situation | Error |
|---|---|
| Generated JSON missing / filter not installed | `TranslationKeysError: TranslationKeysContext is not provided. Did you forget to install the 'translation-keys' Regolith filter...` |
| Key not found in map | `TranslationKeysError: Cannot calculate layout for localizationKey "ui.foo" — no resolved string found...` |

Both errors are exported from `@bedrock-core/ui` as `TranslationKeysError` so you can catch them specifically.

## Settings

| Setting | Type | Default | Description |
|---|---|---|---|
| `vanillaLangUrl` | `string` | Mojang bedrock-samples URL | URL to fetch vanilla `en_US.lang` from |
| `cacheMaxAgeHours` | `number` | `24` | Hours before the vanilla cache is considered stale |
| `outputJsonPath` | `string` | `data/translation-keys/translationKeys.generated.json` | Output path for the JSON map, relative to the Regolith temp directory |
| `langFiles` | `string[]` | `["RP/texts/en_US.lang", "BP/texts/en_US.lang"]` | Pack lang files to merge on top of vanilla, in order |

Example with explicit settings:

```jsonc
{
  "filter": "translation-keys",
  "settings": {
    "cacheMaxAgeHours": 48,
    "langFiles": ["RP/texts/en_US.lang"]
  }
}
```

## Vanilla data cache

Vanilla lang content is fetched from GitHub and cached at:

```
.regolith/cache/translation-keys/vanilla-en_US.lang.cache
```

The cache lives in `.regolith/cache/` and is cleaned with `regolith clean`. The cache is refreshed when it is older than `cacheMaxAgeHours` (default: 24 hours).

## How it works

1. Regolith runs this filter inside its temp workspace and sets `ROOT_DIR` to your project root.
2. The filter checks the local cache. If missing or stale, it fetches the vanilla `en_US.lang` from `vanillaLangUrl` and writes the cache.
3. It reads and parses each file in `langFiles` from the temp workspace (if present), merging entries on top of the vanilla set.
4. The merged map is sorted alphabetically by key for determinism and written to `outputJsonPath` as a JSON object.

## Troubleshooting

- **"ROOT_DIR environment variable not set"** — Run via Regolith; this filter relies on Regolith's environment.
- **"HTTP 4xx/5xx"** — Network issue fetching vanilla data. Check your connection or set `vanillaLangUrl` to a local mirror.
- **`TranslationKeysError` at render time** — Either the context is not provided or the key is missing. Check that the filter ran and that the key exists in a `.lang` file under `langFiles`.
- **Key resolves to vanilla text unexpectedly** — Pack lang entries override vanilla (merge order: vanilla → RP → BP). Ensure your pack's `.lang` file is listed in `langFiles`.

## References

- [Minecraft Wiki — Language files](https://minecraft.wiki/w/Resource_pack#Language) — `.lang` file format
- [Mojang bedrock-samples — texts/en_US.lang](https://github.com/Mojang/bedrock-samples/blob/main/resource_pack/texts/en_US.lang) — vanilla string source
- [@bedrock-core/ui — Text component](../../ui/packages/ui-runtime/src/components/Text.ts) — `localizationKey` prop

## Changelog

### 1.1.0

- `TranslationKeysContext` is now seeded automatically at the render root by `@bedrock-core/ui-runtime` — no `TranslationKeysProvider` wrapper is required. `localizationKey` works out of the box once the filter is installed and the tsconfig path alias is configured.
- `TranslationKeysContext` can still be used directly to override the data for a subtree.

### 1.0.0

- Initial release
