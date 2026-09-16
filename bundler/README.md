# bundler

A Regolith filter that bundles an addon's TypeScript from `BP/scripts/` into the single `main.js`
Minecraft executes, with esbuild. It resolves entry points from the project's own `tsconfig.json`,
marks the `@minecraft/*` script modules as external, and reads `jsxImportSource` off that same
`tsconfig.json` so a JSX runtime such as `@bedrock-core/ui` needs no manual esbuild configuration.
It is the [`core`](../core/README.md) stack's last stage: it inlines what every earlier stage
generated and strips the `.ts` sources from the shipped pack.

## Install

```bash
regolith install github.com/bedrock-core/regolith-filters/bundler
```

```jsonc
{
  "filter": "bundler",
  "settings": {
    "debug": true
  }
}
```

`debug` adds source maps, disables minification and keeps function names, for a development
profile — a release profile omits it.

## Documentation

https://bedrock-core.drav.dev/docs/filters/bundler
