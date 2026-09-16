---
'@bedrock-core/regolith-filters_core': major
---

First release. One filter runs the whole stack in the order it depends on: `manifest`, `generator`, `guides`, `i18n`, `ui-compiler`, `bundler`. `shared` settings are merged into every stage and a stage's own key overrides them; `false` skips a stage. The generator runs only when its key is present, because it writes schema types into the project. Install the whole set, since `core` runs each filter from its own folder.
