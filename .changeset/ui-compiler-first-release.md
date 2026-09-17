---
'@bedrock-core/regolith-filters_ui-compiler': minor
---

First release. Compiles screens written in JSX, every `*.screen.tsx` under `BP/scripts`, into static JSON UI in the resource pack. The root picks the screen: `<Screen>` an action form, `<Form>` a native modal form, `<Container entity>` or `<Container block>` a container screen.

A container screen stamps its host: the entity's `minecraft:inventory` size and `core:ui_layout` property, or the block's `minecraft:block_entity` container, dynamic properties and `core:ui_layout` state. A block-hosted screen fails the build past the 54 slots a block holds, or on a block that declares a crafting table. The router hooks the chest screen and the data-driven container screen, and the form router hooks `server_form.json`.

The screens of the bedrock-core apps come from the `core.register()` call; `screens` names further modules only. Settings: `namespace`, `stamp` for the development build stamp on the HUD, `screens` and `pretty`.
