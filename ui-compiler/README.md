# ui-compiler

A Regolith filter that compiles **screens written in JSX** into static JSON UI, and wires each
one to the runtime half of [`@bedrock-core/ui`](https://github.com/bedrock-core/ui) that serves
it.

Three kinds of screen, from the same components and the same file naming. What decides which is
the **root the author wrote**, and there is no default — a screen starting with anything else
fails the build naming the roots:

| Root | Screen | Drawn from |
| --- | --- | --- |
| `<Container entity>` | a custom entity's chest screen | the vanilla chest, through a hook and the addon's router |
| `<Screen>` | an action form | the library's mount, gated on the screen's title |
| `<Form>` | a native modal form | the same mount, with the engine's own fields in place |

Every screen is drawn from the pack: `render()` refuses a screen this build never compiled,
because nothing in the pack answers to its title. A modal keeps the engine's typed controls —
those cannot be compiled — and the compiled layout is everything around them.

## Authoring

A screen is a script module ending in `.screen.tsx`, anywhere under `BP/scripts`, that
default-exports a component. Its root names the screen.

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

The same module is imported by the behaviour pack: a container screen is handed to
`createContainerScreen` from `@bedrock-core/ui/container`, a `<Screen>` or `<Form>` to
`render()`. The build runs the component once to decide the **shape**; the runtime runs it again
per viewer to decide the **values**, and the two walks line up position for position because a
compiled screen cannot change shape.

A compiled screen is baked, so two rules apply to every kind: `<Text>` that changes needs
`maxLength` to reserve room for it, and the shape cannot move between renders. The build refuses
a screen that breaks either, naming the string it saw change.

### The one rule

**A screen module — and everything it imports — must not touch the world at import time.**

The filter evaluates the module once, on the build machine, with `@minecraft/server` and
`@minecraft/server-ui` replaced by a stub that answers any name with nothing. Hooks are fine:
the compiler renders the component with its initial state. What breaks is module-scope code
that reaches for the game — `world.afterEvents.*.subscribe(...)`, `system.run(...)`, a dynamic
property read next to an `import`. Keep that in the module that serves the screen; a screen's
handlers and effects only ever run in game.

## Installation

```bash
regolith install github.com/bedrock-core/regolith-filters/ui-compiler
```

Add it to `config.json` **before** the `bundler` filter — it reads the screen sources the
bundler strips — and **after** `i18n` if you use it, so localized text is measured as its real
string:

```jsonc
{ "filter": "ui-compiler" }
```

No settings are required. The [`core`](../core) filter already runs this stage in that order,
under the `ui-compiler` key of its settings.

## Settings

| Setting | Type | Default | Description |
| --- | --- | --- | --- |
| `namespace` | `string` | declared | The addon's namespace: it prefixes every screen's JSON UI namespace and names the router files. Lowercase `a-z`, `0-9` and `_`. Left unset, it is the `creator` and `pack` of the manifest declared in `core.register()` |
| `stamp` | `boolean` | `false` | Draw a build stamp at the HUD's top-left: a short hash of every compiled screen plus the build clock. For a development profile |
| `screens` | `string[]` | `[]` | Further modules whose default export is a record of screens to compile, for a library the addon's declaration does not already name. Each export key names the screen |
| `pretty` | `false \| { indent?, size? }` | `false` | How every emitted JSON UI file is laid out. Absent or `false` writes it minified. An object lays it out: `indent` is `"tab"` or `"space"` (spaces when omitted), `size` the characters per level (2 for spaces, 1 for tabs when omitted). Laid out, each file is also headed with the comment saying it is generated; minified, it is headerless too — indentation is a large share of a compiled screen's bytes |

Every path — screens under `BP/scripts`, output under `RP/ui/core-ui/screens`, the chest hook at
`RP/ui/chest_screen.json`, entities under `BP/entities`, texts under `RP/texts` — is what the
game needs and is not a setting.

## How a screen is discovered

Every `**/*.screen.tsx` under `BP/scripts`, plus every export of a `screens` module and the
screens an addon's `core.register()` declaration asks for. A screen's **name** is its file name
without the suffix (`furnace.screen.tsx` → `furnace`); with the addon's namespace it becomes the
JSON UI namespace `<namespace>_<name>` and the output file, so it has to be unique across the
addon. Ordinary `.tsx` helpers can sit beside a screen — only the suffix marks one.

A container screen's **layout key**, the number the chest router picks it by, is a hash of
`<namespace>_<name>` folded into 1..3969. It depends on nothing but the screen's own name: a
rebuild never moves it, and two addons built apart never hand out the same key to their first
screens. Two screens of one addon hashing alike is a build failure naming both — rename one.

A form screen needs no such key: its title carries the namespaced name outright.

## What it writes

Almost everything lands in Regolith's temp workspace. The screen module is the only file you
own, and the bundler (which runs after this filter) inlines it into `main.js` and strips the
sources like any other script.

| Output | Where | Why |
| --- | --- | --- |
| `RP/ui/core-ui/screens/<namespace>/<name>.json` | Regolith temp | the compiled screen — one JSON UI namespace, `<namespace>_<name>`, per screen, whichever kind it is. Under the addon's own folder, because a resource pack file is replaced rather than merged by a higher pack's file at the same path |
| `RP/ui/core-ui/screens/<namespace>/faces.json` | Regolith temp | the looks every screen of the addon shares, under `<namespace>_faces`: no bindings, one definition per distinct look however many screens draw it |
| `RP/ui/core-ui/screens/<namespace>/core_build.json` | Regolith temp, `stamp` only | the stamp label the HUD hook mounts |
| `RP/ui/core-ui/screens/<namespace>_router.json` | Regolith temp | the addon's chest router: the addon's root, and one host per container screen, each gated on its layout key |
| `RP/ui/core-ui/screens/<namespace>_forms.json` | Regolith temp | the addon's form router: one gated host per compiled form screen, picked by the title the runtime opens it with |
| `RP/ui/chest_screen.json` | Regolith temp (edited or new copy) | the chest hook: a copy of vanilla's chest file holding one `modifications` entry, inserting the addon's root into `chest.small_chest_panel_top_half` |
| `RP/ui/server_form.json` | Regolith temp (edited or new copy) | the form hook, for every pack but the one that defines the mount: one `modifications` entry inserting the addon's form router into `server_form.main_screen_content` |
| `RP/ui/core-ui/hosts/form/mount.json` | Regolith temp | written **only** by the pack that defines the mount — the library's own. Its screens are listed in `compiled_root.controls` directly |
| `RP/ui/hud_screen.json` | Regolith temp (edited or new copy), `stamp` only | the HUD hook the stamp mounts through |
| `RP/ui/_ui_defs.json` | Regolith temp (edited or new copy) | every file above registered, or the game never loads them |
| `RP/texts/<locale>.lang` | Regolith temp (appended) | the character table `<Text maxLength>` decodes through; only written when a container screen has live text |
| `BP/entities/<file>.json` | Regolith temp (edited copy) | the entity each container screen names — see [Entities](#entities) |
| `data/ui/declared.screens.ts` | Regolith temp | the screens that follow from `core.register()`: what each installed app shapes from its declaration and the manifest — the addon's page in the catalog, one config screen per section of its schema |
| `data/ui/ui.generated.ts` | Regolith temp | one `registerCompiledScreen` call per compiled form, the `UI_REFERENCE` table of the screens nothing about which can change, `SCREEN_KEYS` and `uiReference()` |
| `<dataPath>/ui/screens.generated.d.ts` | **the project** | the same screen keys, declared where the editor reads them: the generated module above only exists inside a Regolith run, so without this `navigate()` takes any string. Written only when the content changed |

The filter adds `import '@bedrock-core/generated/ui';` to the workspace copy of the script entry
(`BP/scripts/main.ts` or `BP/scripts/index.ts`), so the registrations run without the addon
remembering the import. The addon's own file is untouched.

## Mounts and hooks

Nothing is *defined* in a file at vanilla's path. A definition there would replace vanilla's and
every other pack's, while a `modifications` entry on the file at vanilla's own path stacks with
the render pack's edits and with every other addon's, in whatever order the packs sit — which is
what lets addons built apart meet on one chest and one form screen. The definitions live in the
addon's own router files, named after its namespace, so two addons' routers never overwrite each
other in a world.

The form mount is the library's own file rather than a vanilla one, and is the one exception:
the pack that **defines** `compiled_root` lists its screens in that definition directly, because
modifying a definition the same file declares asks the engine to patch what it is reading. Every
other pack hooks vanilla's `server_form.json` instead — a `modifications` entry against another
pack's file arrives as an unknown property and the screens never mount.

## Entities

A container screen names the entity it opens from (`<Container entity={'core:furnace'}>`). The
filter finds that entity's definition under `BP/entities` by its `identifier` — a screen naming
an entity that is not there fails the build — and edits the workspace copy:

```jsonc
"description": {
  "properties": {
    // The runtime reads this when a player opens the entity, to pick the screen.
    // `default` is that screen's own layout key, derived from its name.
    "core:ui_layout": { "type": "int", "range": [0, 3969], "default": 2871 }
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

Nobody keeps `inventory_size` or a layout key in step with a layout by hand — the failure mode
of that is a screen that silently draws cells the container does not have, or an entity that
opens the wrong screen. Everything else on the entity is yours.

This is also why a container screen gets no navigation key: it is reached by opening an entity,
not by `navigate()` or a `<Link to>`. `SCREEN_KEYS` and the generated declaration carry the
addon's form screens.

## What it fails on

The filter stops the build rather than warning past a problem:

- Two screens sharing a name, or two container screens hashing to the same layout key.
- No namespace: neither the `namespace` setting nor `manifest: { creator, pack }` in
  `core.register()`.
- A container screen naming an entity that is not under `BP/entities`, or two naming the same
  entity — one entity opens one screen.
- A `screens` module that default-exports no screens.
- Anything the compiler refuses, relayed in its own words: a control the host has no mechanism
  for, content past the 320 × 210 canvas, a `<Container>` with no `entity`, a `<Text>` that
  changes with state but is baked into the layout or into a button's face, a host that moved a
  face it was only meant to stand in.

No `*.screen.tsx` under `BP/scripts` and no `screens` setting is an info-level no-op.
