# @bedrock-core/regolith-filters_ui-compiler

## 0.1.0

### Minor Changes

- [#1](https://github.com/bedrock-core/regolith-filters/pull/1) [`f2994c3`](https://github.com/bedrock-core/regolith-filters/commit/f2994c3082c9cd5e1f84279dac2bcc0adc56cb08) Thanks [@drav0011](https://github.com/drav0011)! - Every screen is built with the strings of each language `RP/texts/languages.json` lists, so text a screen composes per language — a baked breadcrumb trail, a paragraph with links — is composed from them. What the screens composed is written into each language's `.lang`, in a section of its own.

- [#1](https://github.com/bedrock-core/regolith-filters/pull/1) [`168059a`](https://github.com/bedrock-core/regolith-filters/commit/168059ad5e9b5e7ba5da808f59a0f6bdf98a3ea5) Thanks [@drav0011](https://github.com/drav0011)! - First release. Compiles screens written in JSX, every `*.screen.tsx` under `BP/scripts`, into static JSON UI in the resource pack. The root picks the screen: `<Screen>` an action form, `<Form>` a native modal form, `<Container entity>` or `<Container block>` a container screen.
  
  A container screen stamps its host: the entity's `minecraft:inventory` size and `core:ui_layout` property, or the block's `minecraft:block_entity` container, dynamic properties and `core:ui_layout` state. A block-hosted screen fails the build past the 54 slots a block holds, or on a block that declares a crafting table. The router hooks the chest screen and the data-driven container screen, and the form router hooks `server_form.json`.
  
  The screens of the bedrock-core apps come from the `core.register()` call; `screens` names further modules only. Settings: `namespace`, `stamp` for the development build stamp on the HUD, `screens` and `pretty`.

- [#1](https://github.com/bedrock-core/regolith-filters/pull/1) [`953fc18`](https://github.com/bedrock-core/regolith-filters/commit/953fc18194100e1cb6812265dd8c3e51b4944a4f) Thanks [@drav0011](https://github.com/drav0011)! - Writes the container screen protocol items into the behaviour pack: one set per namespace of an entity or block a compiled screen opens from, under `BP/items/core-ui/<namespace>/`. A library that still places vanilla items has none to write.

### Patch Changes

- [#1](https://github.com/bedrock-core/regolith-filters/pull/1) [`f2994c3`](https://github.com/bedrock-core/regolith-filters/commit/f2994c3082c9cd5e1f84279dac2bcc0adc56cb08) Thanks [@drav0011](https://github.com/drav0011)! - The generated table of static screens carries each link's params beside its key, so a static screen opens its target with them.
