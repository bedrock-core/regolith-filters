# ui-compile

A Regolith filter that compiles **container screens** — a custom entity's chest screen, written
in JSX with the same components as a form — into static JSON UI, and prepares everything the
runtime half of [`@bedrock-core/ui`](https://github.com/bedrock-core/ui) needs to drive them: the
router that puts a compiled layout on the vanilla chest screen, the character table live text
decodes through, and the entity each screen opens from.

A server form is serialized per player at runtime. A container screen cannot be: the chest
screen has no string channel wide enough to carry a layout, so the layout is baked at build time
and only state travels at runtime, through the container's own slots. This filter is the baking.

## Authoring

A screen is a script module ending in `.screen.tsx`, anywhere under `BP/scripts`, that
default-exports a component rendering a `<Container>` at its root:

```tsx
// packs/BP/scripts/screens/furnace.screen.tsx
/** @jsxImportSource @bedrock-core/ui */
import { Container, Slot, Text, useState } from '@bedrock-core/ui';

export default function Furnace() {
  const [count, setCount] = useState(0);

  return (
    <Container entity={'core:furnace'} padding={8} gap={6}>
      <Text maxLength={12}>{`smelted ${count}`}</Text>
      <Slot role={'input'} onInsert={() => setCount(value => value + 1)} />
    </Container>
  );
}
```

The same module is imported by the behaviour pack and handed to `createContainerScreen`, which
serves it to every player who opens the entity. The build runs the component once to decide the
**shape**; the runtime runs it again per viewer to decide the **values**, and the two walks line
up position for position because a compiled screen cannot change shape. Nothing about a screen
is declared twice.

### The one rule

**A screen module — and everything it imports — must not touch the world at import time.**

The filter evaluates the module once, on the build machine, with `@minecraft/server` and
`@minecraft/server-ui` replaced by a stub that answers any name with nothing. Hooks are fine:
the compiler renders the component with its initial state. What breaks is module-scope code
that reaches for the game — `world.afterEvents.*.subscribe(...)`, `system.run(...)`, a dynamic
property read next to an `import`. Keep that in the module that calls `createContainerScreen`;
a screen's handlers and effects only ever run in game.

## What it generates

Everything lands in Regolith's temp workspace. **Nothing is synced back to the project** — no
handle, no declaration file, no copy of the source. The screen module is the only file you own,
and the bundler (which runs after this filter) inlines it into `main.js` and strips the sources
like any other script.

| Output | Where | Why |
| --- | --- | --- |
| `RP/ui/core-ui/screens/<name>.json` | Regolith temp | the compiled screen — one JSON UI namespace, `core_ui_<name>`, per screen |
| `RP/ui/chest_screen.json` | Regolith temp | the router, gating every compiled layout onto the vanilla chest screen — see [The router](#the-router) |
| `RP/ui/_ui_defs.json` | Regolith temp (edited copy) | both of the above registered, or the game never loads them |
| `RP/texts/<locale>.lang` | Regolith temp (appended) | the character table `<Text maxLength>` decodes through; only written when a screen has live text |
| `BP/entities/<file>.json` | Regolith temp (edited copy) | the entity each screen names: `minecraft:inventory` sized to the layout, and a `core:ui_layout` property carrying the screen's key — see [Entities](#entities) |

## How a screen is discovered

Every `**/*.screen.tsx` under `sourceDir`, sorted by path. A screen's **name** is its file name
without the suffix (`furnace.screen.tsx` → `furnace`); it becomes the JSON UI namespace
`core_ui_furnace` and the output file, so it has to be unique across the addon. Ordinary `.tsx`
helpers can sit beside a screen — only the suffix marks one.

A screen's position in that sorted list is its **layout key**, the number the router picks it
by. Sorting keeps the key stable across builds: an entity keeps the key it was stamped with, so
a key that moved would leave every already-placed entity in a world opening the wrong screen.
Name a new screen so it sorts after the ones you already ship.

## The router

One router covers every screen. A marker item in the container's slot 0 carries a protocol key
(is this chest a compiled screen at all?) and a layout key (which one?), and the router shows the
layout whose key matches. A vanilla chest has no marker, fails the first check and renders
untouched.

`routerFile` **must be `RP/ui/chest_screen.json`, vanilla's own path.** JSON UI resolves a
definition from the file that owns it: a replacement of `chest.small_chest_panel` declared in any
other file — same namespace or not — is silently ignored, and the ordinary chest renders. The
setting exists so the path is visible, not so it can move.

## Entities

A screen names the entity it opens from (`<Container entity={'core:furnace'}>`). The filter finds
that entity's definition under `entityDir` by its `identifier` — a screen naming an entity that
is not there fails the build — and edits the workspace copy:

```jsonc
"description": {
  "properties": {
    // The runtime reads this when a player opens the entity, to pick the screen.
    "core:ui_layout": { "type": "int", "range": [0, 2000], "default": 1 }
  }
},
"components": {
  "minecraft:inventory": {
    "container_type": "container", // the only type that routes to the chest screen
    "inventory_size": 75,          // drawn slots + live channels; a hand-written value is overwritten
    "private": false               // `true` stops the player opening it at all
  }
}
```

Nobody keeps `inventory_size` in step with a layout by hand — the failure mode of that is a
screen that silently draws cells the container does not have. Everything else on the entity is
yours.

## Installation

```bash
regolith install github.com/bedrock-core/regolith-filters/ui-compile
```

Add it to `config.json` **before** the `bundler` filter — it reads the screen sources the bundler
strips — and **after** `i18n` if you use it, so the character table is not carried into the
translation bundle:

```jsonc
{ "filter": "ui-compile" }
```

No settings are required.

## Settings

| Setting | Type | Default | Description |
| --- | --- | --- | --- |
| `sourceDir` | `string` | `"BP/scripts"` | Where screens are looked for, relative to the Regolith temp workspace. Only files ending in `.screen.tsx` are compiled |
| `outputDir` | `string` | `"RP/ui/core-ui/screens"` | Where the compiled screens are written. Registered in `_ui_defs.json` automatically |
| `routerFile` | `string` | `"RP/ui/chest_screen.json"` | Where the router is written. Must be vanilla's own path — see [The router](#the-router) |
| `entityDir` | `string` | `"BP/entities"` | Where entity definitions are looked for when a screen names the entity it opens from |
| `textsDir` | `string` | `"RP/texts"` | Where the character table is appended, to every `.lang` file there |
| `jsxImportSource` | `string` | `"@bedrock-core/ui"` | `jsxImportSource` used when bundling a screen. Match your tsconfig, or the JSX in a screen will not resolve |

No `*.screen.tsx` under `sourceDir` is an info-level no-op. A screen that fails to compile stops
the build with the compiler's own message — a control the container backend cannot bake, content
past the 320 × 210 canvas, a missing `entity`, live text inside a button — because those messages
already name the fix.
