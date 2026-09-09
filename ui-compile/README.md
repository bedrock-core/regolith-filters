# ui-compile

A Regolith filter that compiles **screens written in JSX** into static JSON UI, and prepares
everything the runtime half of [`@bedrock-core/ui`](https://github.com/bedrock-core/ui) needs to
drive them.

Two kinds of screen, from the same components and the same file naming. What decides which is
the **root the author wrote**:

| Root | Screen | What the layout is mounted on |
| --- | --- | --- |
| `<Container entity>` | a custom entity's chest screen | the vanilla chest, through a hook and a router |
| anything else | a server form | the library's own container, which is already gated on the protocol header — no vanilla file is touched |

Compiling is worth different things to each. A container screen **cannot** be serialized at all:
the chest screen has no string channel wide enough to carry a layout, so baking is the only way
it exists. A form screen can be serialized, and is by default — compiling it means the layout is
written into the pack once instead of being shipped again on every press, and only what changed
travels.

## Authoring

A screen is a script module ending in `.screen.tsx`, anywhere under `BP/scripts`, that
default-exports a component. A `<Container>` at its root makes it a container screen; anything
else makes it a form.

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

A form screen is the same file without the `<Container>`, and is opened with `render()` like any
other screen:

```tsx
// packs/BP/scripts/screens/counter.screen.tsx
/** @jsxImportSource @bedrock-core/ui */
import { Button, Panel, Text, useState } from '@bedrock-core/ui';

export default function Counter() {
  const [count, setCount] = useState(0);

  return (
    <Panel padding={8} gap={6}>
      <Text maxLength={16}>{`count ${count}`}</Text>
      <Button enabled={count < 9} onPress={() => setCount(n => n + 1)}>{'+'}</Button>
    </Panel>
  );
}
```

```ts
// anywhere in the addon
import '@bedrock-core/generated/ui';   // once: what tells the runtime this screen was compiled
import Counter from './screens/counter.screen';

render(Counter, player);
```

Without that import every screen still renders — serialized by the interpreter, exactly as
before — which is what makes compiling additive rather than a migration.

A compiled screen is baked, so the same two rules apply to both kinds: `<Text>` that changes
needs `maxLength` to reserve room for it, and the shape cannot move between renders. The build
refuses a screen that breaks either, naming the string it saw change.

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
| `RP/ui/core-ui/screens/<name>.json` | Regolith temp | the compiled screen — one JSON UI namespace, `<namespace>_<name>`, per screen, whichever kind it is |
| `RP/ui/core-ui/screens/faces.json` | Regolith temp | the looks every screen of the addon shares, under `<namespace>_faces`: no bindings, one definition per distinct look however many screens draw it |
| `RP/ui/core-ui/screens/<name>.preview.json` | Regolith temp, `gallery` only | the screen as faces alone under `<namespace>_<name>__preview`, gated on its own title |
| `RP/ui/core-ui/screens/gallery.json` | Regolith temp, `gallery` only | a compiled screen listing every screen of the addon; a press opens that screen's preview |
| `RP/ui/core-ui/screens/<namespace>_forms.json` | Regolith temp | the addon's compiled FORM screens: one gated host each, picked by the title the runtime opens them with |
| `RP/ui/core-ui/form/mount.json` | Regolith temp (edited or new copy) | the addon's insert into the library's form mount. A modification of the mount's own path, so every pack's copy stacks |
| `data/ui/ui.generated.ts` | Regolith temp | one `registerCompiledScreen` call per compiled form, and `openGallery(player)`. Import it once (`@bedrock-core/generated/ui`) and `render()` shows those screens from the pack instead of serializing them |
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
| `stamp` | `boolean` | `false` | Draw a build stamp at the HUD's top-left: a short hash of every compiled screen plus the build clock. For a development profile |
| `gallery` | `boolean` | `false` | Write every screen's preview — the screen as faces alone, no host behind it — and a gallery screen that opens each, reached as `openGallery(player)` from `@bedrock-core/generated/ui`. For a development profile: the place a screen is looked at before any host serves it |
| `screens` | `string[]` | `[]` | Modules whose default export is a record of screens to compile besides the addon's own `*.screen.tsx`, such as `@bedrock-core/config/compiled` |

Every path — screens under `BP/scripts`, output under `RP/ui/core-ui/screens`, the hook at
`RP/ui/chest_screen.json`, entities under `BP/entities`, texts under `RP/texts` — is what the game
needs and is not a setting.

No `*.screen.tsx` under `BP/scripts` is an info-level no-op. A screen that fails to compile stops
the build with the compiler's own message — a control the container backend cannot bake, content
past the 320 × 210 canvas, a missing `entity`, live text inside a button — because those messages
already name the fix.
