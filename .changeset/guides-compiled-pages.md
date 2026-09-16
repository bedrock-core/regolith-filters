---
'@bedrock-core/regolith-filters_guides': minor
---

The key namespace is read from the `core.register({ manifest: { creator, pack } })` call, the same way `i18n` and `ui-compiler` read it; `namespace` stays as an override and is no longer required.

With `compileScreens` on, every page becomes its own screen module under `screensDir`, `guide_<page>.screen.tsx`, plus `guide_home` and a `guide_home_back` index for a host that opens the guide and returns to it. `screenTitle` is the header baked into each page and `componentsModule` names the module whose default export is the component registry the pages use. Each page's screen name is written into the manifest, so a link inside a guide reaches the screen the build compiled.
