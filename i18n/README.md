# i18n

A Regolith filter that makes nested TypeScript objects the source of truth for an addon's text.
One module per locale under `data/i18n/`, each default-exporting a nested object typed with
`as const` — from it the filter generates the `.lang` files Bedrock resolves per player, the
runtime bundle [`@bedrock-core/i18n`](https://github.com/bedrock-core/server) resolves on the
server, and the types that autocomplete every key and interpolation variable. In the
[`core`](../core/README.md) stack it runs after `guides` and before `ui-compiler`, so guide text
is captured and every screen measures localized text as the real string it will draw.

## Install

```bash
regolith install github.com/bedrock-core/regolith-filters/i18n
```

```ts
// packs/data/i18n/en_US.ts
export default {
  shop: {
    title: 'Shop',
    bought: 'You bought {{item}} for {{price}} emeralds.',
  },
} as const;
```

## Documentation

https://bedrock-core.drav.dev/docs/filters/i18n
