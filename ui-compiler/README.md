# ui-compiler

A Regolith filter that compiles **screens written in JSX** into static JSON UI, and wires each
one to the runtime half of [`@bedrock-core/ui`](https://github.com/bedrock-core/ui) that serves
it.

A screen is a module ending in `.screen.tsx`, anywhere under `BP/scripts`, that default-exports a
component. Its root decides what it compiles to, and there is no default — a screen starting with
anything else fails the build naming the roots:

| Root | Screen | Drawn from |
| --- | --- | --- |
| `<Container entity>` | a custom entity's container screen | the vanilla chest, through a hook and the addon's router |
| `<Container block>` | a custom block's container screen | the vanilla data-driven container, through a second hook and the same router |
| `<Screen>` | an action form | the library's mount, gated on the screen's title |
| `<Form>` | a native modal form | the same mount, with the engine's own fields in place |


## Install

```bash
regolith install github.com/bedrock-core/regolith-filters/ui-compiler
```

Add it to `config.json` **before** `bundler` — it reads the screen sources the bundler strips —
and **after** `i18n` if you use it, so localized text is measured as its real string. The
[`core`](../core/README.md) filter already runs it in that order.

```tsx
// packs/BP/scripts/screens/furnace.screen.tsx
/** @jsxImportSource @bedrock-core/ui */
import { Container, Slot, Text, useState } from '@bedrock-core/ui';

export default function Furnace() {
  const [count, setCount] = useState(0);

  return (
    <Container entity={'core:furnace'} padding={8} gap={6}>
      <Text maxLength={12}>{`smelted ${count}`}</Text>
      <Slot
        role={'input'}
        onInsert={({ player, stack }) => {
          setCount(value => value + stack.amount);
          player.sendMessage(`+${stack.amount}`);
        }}
      />
    </Container>
  );
}
```

A screen module — and everything it imports — must not touch the world at import time: the filter
evaluates it once, on the build machine, with `@minecraft/server` and `@minecraft/server-ui`
stubbed out. Hooks are fine; module-scope code that reaches for the game is not. Keep that in the
module that serves the screen — a screen's handlers and effects only ever run in game.

## Test metadata

Set `testMetadata: true` in this filter's settings to write
`RP/bedrock-core/test-metadata.json`. With `core`, use
`settings["ui-compiler"].testMetadata`. The default is `false`.

The version 1 manifest contains screen and control identities, semantic roles
and names, property paths to emitted control instances, and SHA-256 hashes of
the exact UI files. It does not instrument controls or change form responses.
The schema and TypeScript types are available through
`@bedrock-core/ui-compiler/testing` and `@bedrock-core/ui-compiler/testing/schema`.
The manifest is rebuilt deterministically when enabled and removed when disabled.

## Documentation

https://bedrock-core.drav.dev/docs/filters/ui-compiler
