# i18n

A Regolith filter that makes **nested TypeScript objects the source of truth** for your addon's
text, and generates everything downstream from them: the `.lang` files Bedrock resolves on each
player's client, the runtime bundle `@bedrock-core/i18n` resolves on the server, and the types
that make every key and interpolation variable autocomplete.

Replaces `translation-keys`, which ran the other way round.

## Authoring

One module per locale in `packs/data/i18n/`, each default-exporting a nested object:

```ts
// packs/data/i18n/en_US.ts
export default {
  shop: {
    title: 'Shop',
    bought: 'You bought {{item}} for {{price}} emeralds.',
    stock_one: '{{count}} left in stock',
    stock_other: '{{count}} left in stock',
  },
} as const;
```

`as const` matters: it is what lets the compiler infer the key space and the interpolation
variables each template requires.

The default locale (`defaultLocale`, `en_US` unless configured) is the **shape**: every other
locale file must carry exactly its key set, and the build checks parity in both directions.

At a call site the tree is rooted at your own keys, with two branches grafted in:

```ts
t($ => $.shop.bought, { item, price })   // yours — packs/data/i18n
t($ => $.core.addons.title)              // a library's strings
t($ => $.vanilla.item.apple.name)        // vanilla Minecraft

t('shop.bought', { item, price })        // the string form is typed identically
```

`vanilla` is reserved — authoring a top-level key with that name is a build error. Library
branches like `core` are override-only: see [Libraries](#libraries).

## Namespacing

Every key you author lands in the `.lang` files prefixed with your addon's namespace:
`shop.bought` becomes `drav0011_shop.shop.bought`. The prefix is what keeps addons from
colliding everywhere their text meets: Bedrock merges every installed pack's `.lang` into one
world-wide table, and the server runtime merges every addon's published translation tables (and
config, and guides) into shared replicated state under the same namespace.

The namespace is **derived, not configured**: the filter scans your scripts for the
`core.register({ creator: '...', pack: '...' })` call and joins the two string literals —
the same two fields the server runtime's `addonNamespace()` joins at startup, so the build-time
`.lang` prefix and the runtime state namespace cannot diverge. When the scan finds no call, or
finds `creator`/`pack` composed at runtime instead of written as literals, the build fails and
names the fix: either make them literals or set the `namespace` setting, which is required only
in that case.

Call sites never spell the namespace — `key()` and `raw()` prepend it at runtime from the
bundle's metadata.

## What it generates

| Output | Where | Why |
| --- | --- | --- |
| `RP/texts/<locale>.lang` | your pack | what Bedrock resolves, per player, in their language |
| `RP/texts/languages.json` | your pack | kept in sync with the locales you author |
| `data/i18n/i18n.generated.json` | Regolith temp | per-locale tables + interpolation arg order + namespace, inlined into the script bundle |
| `data/i18n/i18n.generated.d.ts` | your project (commit it) | types the bundle module: your resources at the root, libraries and `vanilla` grafted on |
| `data/i18n/vanilla.generated.d.ts` | your project (commit it) | the vanilla key tree, so `$.vanilla.*` autocompletes |

The `.lang` files are written into the pack because Bedrock reads them at runtime. The generated
JSON stays in Regolith's temp workspace and is never synced back — the bundler resolves the
`packs/data` alias against the temp workspace and inlines it. The two `.d.ts` files ARE synced
back and committed: they are what the IDE reads, so autocompletion works without ever running a
build. The root of `i18n.generated.d.ts` is `typeof import('./en_US').default` — your authored
literal types pass through untouched, which is what makes interpolation-variable inference work.

Add the alias to `tsconfig.json` (and keep `packs/data/**/*` in `include`):

```json
{
  "compilerOptions": {
    "paths": {
      "@bedrock-core/generated/i18n": ["./packs/data/i18n/i18n.generated.json"]
    }
  }
}
```

## Libraries

A library ships its strings inside its own package — `@bedrock-core/config` keeps them in
`src/i18n/<locale>.ts` — and declares them in its `package.json`, together with an export that
makes them reachable for the generated types:

```jsonc
"bedrockCore": { "i18n": { "dir": "./src/i18n", "namespace": "core" } },
"exports": { "./i18n/*": { "types": "./src/i18n/*.ts", "import": "./src/i18n/*.ts" } }
```

The filter walks your dependencies for that field and folds each library's resources in under
the declared namespace (`core` for the whole bedrock-core family — several packages may share
one namespace; a key two packages define with different values is a build error): its keys are
emitted into your `.lang` files, its tree appears under `$.core.*`, and its strings ride in your
runtime bundle.

Library branches are **override-only** from `data/i18n`: you may author `core.addons.title` to
deliberately rename a library string ("Addons" → "Mods"), and your value wins — but only for
paths the library actually defines. An unknown path under a library branch is a build error, and
overrides are exempt from the parity check (override in one locale without the others and the
library's own translation fills the gap).

## Vanilla strings

Always available for autocompletion under `$.vanilla.*` — the full vanilla tree (~10k keys) is
generated into `vanilla.generated.d.ts`. Never emitted into your RP: the client already ships
those strings, so re-adding them would only bloat the pack.

Server-side values (what `t()` returns and what the layout engine measures) are included in the
runtime bundle **only for the keys your compiled scripts actually reference** — the filter scans
the compiled output for string literals and for `$.vanilla.` selector chains. A key assembled at
runtime (`'item.' + id + '.name'`) is not found: `key()`/`raw()` still resolve on the client,
but `t()` falls back to the raw key and measurement for that one string is approximate. Set
`vanilla: false` to skip the fetch and the branch entirely.

Vanilla `.lang` content is fetched per locale from Mojang's `bedrock-samples` and cached in
`.regolith/cache/i18n/` (see `cacheMaxAgeHours`).

## Interpolation

`{{var}}` syntax is rewritten to Minecraft's positional form for the `.lang` files, and the
argument **order** is recorded alongside it:

```
'You bought {{item}} for {{price}}'  →  'You bought %1$s for %2$s'   args: ['item', 'price']
```

The runtime bundle keeps the original `{{var}}` template plus that recorded order — the order is
the contract with `raw()` in `@bedrock-core/i18n`, which builds the matching `with` array at
runtime. The two sides are pinned against a shared table in `test/contract.test.js` — if either
drifts, a test fails rather than arguments silently landing in the wrong placeholders.

Two conveniences deliberately do not exist:

- **`$t(other.key)` nesting** is flattened at build time — Bedrock `.lang` has no nesting.
- **Format functions** (`{{price, currency}}`) are not supported at all: a format function is
  JavaScript and cannot travel to the client. Format in code, pass the result as the argument.

## What the build checks

Everything here converts a silent runtime failure into a build error naming the path to fix:

- **Locale parity.** Every non-default locale must have exactly the default locale's key set
  (library overrides exempt). Missing keys mean a player sees raw keys; *extra* keys almost
  always mean a rename landed in one file and not the other.
- **Reserved branches.** `vanilla` is never authorable; library branches only for paths the
  library defines.
- **Plural sets.** A `_one` without its `_other` (or vice versa) is an error, per locale.
- **Usable output.** Single-line values, `key=value`-safe key segments, valid Bedrock locale
  codes as filenames, nesting depth ≤ 6 (past that, type-level path recursion degrades the whole
  key union to `string` with nothing to explain why).

Set `strict: false` to warn instead of failing.

## Coexisting with the guides filter

Both filters write into `RP/texts/<locale>.lang`, each inside its own marker-delimited section,
and each rewrites only its own. Hand-written entries in the same file are left untouched.

## Installation

```bash
regolith install github.com/bedrock-core/regolith-filters/i18n
```

Add it to `config.json` **before** the `bundler` filter, and after `guides` if you use it:

```jsonc
{ "filter": "i18n" }
```

No settings are required when the `core.register` scan succeeds.

## Settings

| Setting | Type | Default | Description |
| --- | --- | --- | --- |
| `namespace` | `string` | derived | Overrides the `core.register` scan; **required** only when the scan fails |
| `defaultLocale` | `string` | `"en_US"` | The locale whose file defines the shape and types |
| `vanilla` | `boolean` | `true` | Generate `$.vanilla.*` types and bundle used vanilla strings |
| `vanillaLangUrlTemplate` | `string` | bedrock-samples URL | Where vanilla `.lang` is fetched from — `{locale}` is replaced |
| `cacheMaxAgeHours` | `number` | `24` | Hours before a locale's cached vanilla `.lang` is stale |
| `strict` | `boolean` | `true` | Fail the build on check violations instead of warning |

## Migrating from translation-keys

```bash
node bin/from-lang.js
```

Converts your existing `RP/texts/*.lang` entries into `packs/data/i18n/<locale>.ts` modules
(namespace prefix stripped back off), then swap the filter in `config.json`. `translation-keys`
keeps working for one release.
