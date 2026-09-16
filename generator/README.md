# generator

A Regolith filter that writes Minecraft JSON as TypeScript: it finds `.ts` template files
anywhere under `BP/`/`RP`, runs them, and writes the JSON beside them — one file, or many from a
list. Templates are typed against Mojang's official JSON Schemas as you write them, through global
type aliases such as `Block`, `Entity` and `Item` used in a `satisfies` clause; nothing about the
type reaches the runtime. In the [`core`](../core/README.md) stack it is opt-in, since it writes
generated types into the project — a profile turns it on rather than getting it by default.

## Install

```bash
regolith install github.com/bedrock-core/regolith-filters/generator
```

A default-exported object typed with `satisfies` becomes one `.json` with the same basename:

```ts
// BP/entities/training_dummy.entity.ts  ->  training_dummy.entity.json
export default {
  format_version: '1.21.0',
  'minecraft:entity': {
    description: { identifier: 'example:training_dummy', is_summonable: true },
    components: {
      'minecraft:health': { value: 20, max: 20 },
      'minecraft:physics': {},
    },
  },
} satisfies Entity;
```

## Documentation

https://bedrock-core.drav.dev/docs/filters/generator
