# ui-compile

A Regolith filter that compiles **container screens** — a custom entity's chest screen, written
in JSX with the same components as a form — into static JSON UI, and prepares everything the
runtime half of [`@bedrock-core/ui`](https://github.com/bedrock-core/ui) needs to drive them: the
hook and router that put a compiled layout on the vanilla chest screen, the character table live
text decodes through, and the entity each screen opens from.

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
| `RP/ui/core-ui/screens/<name>.json` | Regolith temp | the compiled screen — one JSON UI namespace, `<namespace>_<name>`, per screen |
| `RP/ui/core-ui/screens/<namespace>_router.json` | Regolith temp | the addon's router: a gated host per screen under the addon's root — see [The router](#the-router) |
| `RP/ui/chest_screen.json` | Regolith temp | the hook: a copy of vanilla's chest file holding one `modifications` entry, inserting the addon's root into the chest top half the render pack's chest root mounts on both UI profiles |
| `RP/ui/_ui_defs.json` | Regolith temp (edited or new copy) | the three above registered, or the game never loads them |
| `RP/texts/<locale>.lang` | Regolith temp (appended) | the character table `<Text maxLength>` decodes through; only written when a screen has live text |
| `BP/entities/<file>.json` | Regolith temp (edited copy) | the entity each screen names: `minecraft:inventory` sized to the layout, and a `core:ui_layout` property carrying the screen's key — see [Entities](#entities) |

## How a screen is discovered

Every `**/*.screen.tsx` under `BP/scripts`. A screen's **name** is its file name without the
suffix (`furnace.screen.tsx` → `furnace`); with the addon's namespace it becomes the JSON UI
namespace `<namespace>_furnace` and the output file, so it has to be unique across the addon.
Ordinary `.tsx` helpers can sit beside a screen — only the suffix marks one.

A screen's **layout key**, the number the router picks it by, is a hash of `<namespace>_<name>`
folded into 1..3969. It depends on nothing but the screen's own name: a rebuild never moves it,
and two addons built apart never hand out the same key to their first screens. Two screens of one
addon hashing alike is a build failure naming both — rename one.

## The router

A marker item in the container's slot 0 carries a protocol key (is this chest a compiled screen
at all?) and a layout key (which one?), and the chest shows the layout whose key matches. A
vanilla chest has no marker, fails the first check and renders untouched.

The **hook** is the addon's copy of vanilla's `chest_screen.json`, holding one `modifications`
entry that inserts the addon's root into `chest.small_chest_panel_top_half`. Nothing is defined in
it on purpose: a definition in a vanilla file replaces vanilla's and every other pack's, while a
modification of the file at vanilla's own path stacks with the render pack's edits and with every
other addon's, in whatever order the packs sit. The target declares its own `controls` — an insert
on a definition that only inherits the array creates one that shadows it. The render pack's own
copy of the file points the chest screen's content at the library's chest root, which shows
vanilla's own chest panel for any chest no compiled screen claims and, for a claimed one, the
chrome and that top half again with its label and grid gated off, so only the roots show.

The **router** is the addon's own file, named after its namespace: the addon's root, and one
gated host per screen under it.

## Entities

A screen names the entity it opens from (`<Container entity={'core:furnace'}>`). The filter finds
that entity's definition under `entityDir` by its `identifier` — a screen naming an entity that
is not there fails the build — and edits the workspace copy:

```jsonc
"description": {
  "properties": {
    // The runtime reads this when a player opens the entity, to pick the screen.
    "core:ui_layout": { "type": "int", "range": [0, 3969], "default": 1 }
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
| `namespace` | `string` | scanned | The addon's namespace: it prefixes every screen's JSON UI namespace and names the router file. Left unset, it is read from the `creator` and `pack` string literals in `core.register()` |

Every path — screens under `BP/scripts`, output under `RP/ui/core-ui/screens`, the hook at
`RP/ui/chest_screen.json`, entities under `BP/entities`, texts under `RP/texts` — is what the game
needs and is not a setting.

No `*.screen.tsx` under `BP/scripts` is an info-level no-op. A screen that fails to compile stops
the build with the compiler's own message — a control the container backend cannot bake, content
past the 320 × 210 canvas, a missing `entity`, live text inside a button — because those messages
already name the fix.
