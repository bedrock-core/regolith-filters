# Core

One filter that runs the whole Bedrock Core stack in the order the filters depend on — `manifest`,
`generator`, `guides`, `i18n`, `ui-compiler`, `bundler` — with the namespace declared once.

Full manual: <https://bedrock-core.drav.dev/docs/filters/core>

## Install

`core` runs the other filters from their own folders, so install the whole set rather than `core`
alone:

```bash
regolith config resolvers --append github.com/bedrock-core/regolith-filters/resolver.json
regolith install core manifest generator guides i18n ui-compiler bundler
```

One entry per profile then replaces the six:

```jsonc
{
  "regolith": {
    "profiles": {
      "default": {
        "filters": [
          {
            "filter": "core",
            "settings": {
              "shared": { "namespace": "drav0011_economy" },
              "ui-compiler": { "screens": ["@bedrock-core/config/compiled"] },
              "bundler": { "debug": true }
            }
          }
        ]
      },
      "test": {
        "filters": [
          {
            "filter": "core",
            "settings": {
              "shared": { "namespace": "drav0011_economy" },
              "manifest": { "manifestPath": "BP/manifest.test.json" },
              "ui-compiler": { "screens": ["@bedrock-core/config/compiled"] },
              "bundler": { "debug": true, "tsConfigPath": "tsconfig.test.json" }
            }
          }
        ]
      }
    }
  }
}
```

## Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `shared` | object | `{}` | Merged into every stage. The addon's `namespace` belongs here; a stage that does not read a key ignores it. |
| `manifest`, `guides`, `i18n`, `ui-compiler`, `bundler` | object \| `false` | `{}` | Settings for that stage, merged over `shared`. `false` skips the stage. |
| `generator` | object \| `true` | off | The generator runs only when this key is present — it writes schema types into the project, so a project opts in. `true` runs it with its defaults. |

Each stage's own settings are documented in its README; the keys are unchanged here.

A project that needs a step of its own between two stages lists the filters one by one in
`config.json` and puts its own filter where it belongs.
