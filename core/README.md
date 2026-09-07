# Core

One filter that runs the whole Bedrock Core stack, in the order the filters depend on:

| # | Stage | Why here |
|---|-------|----------|
| 1 | [manifest](../manifest/README.md) | picks the profile's manifest variant before anything reads it |
| 2 | [guides](../guides/README.md) | guide keys have to land before i18n collects them |
| 3 | [i18n](../i18n/README.md) | `.lang` files, the runtime bundle and the key types |
| 4 | [ui-compile](../ui-compile/README.md) | screens bake against the keys i18n emitted |
| 5 | [bundler](../bundler/README.md) | last: it inlines the generated bundles and strips the sources |

The [generator](../generator/README.md) is a stage as well, but not a default one: it emits schema
types into the project, so a project opts into it by naming it in `stages`, before the bundler.

Each stage runs in its own Node process, exactly as Regolith runs it — same temp workspace, same
`ROOT_DIR`, same settings JSON, same exit code. A stage whose inputs are absent says it has nothing
to do and the run continues, so the full stack is a safe default even for a project that uses part
of it.

## Use

```jsonc
{
  "regolith": {
    "filterDefinitions": {
      "core": {
        "runWith": "nodejs",
        "script": "../../../regolith-filters/core/main.ts"
      }
    },
    "profiles": {
      "default": {
        "filters": [
          {
            "filter": "core",
            "settings": {
              "shared": { "namespace": "drav0011_economy" },
              "ui-compile": { "screens": ["@bedrock-core/config/compiled"] },
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
              "ui-compile": { "screens": ["@bedrock-core/config/compiled"] },
              "bundler": { "debug": true, "tsConfigPath": "tsconfig.test.json" }
            }
          }
        ]
      }
    }
  }
}
```

The stack runs the other filters from their own folders in this repository, so install the whole
set rather than `core` alone.

## Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `shared` | object | `{}` | Merged into every stage. The addon's `namespace` belongs here; a stage that does not read a key ignores it. |
| `<stage>` | object \| `false` | `{}` | Settings for one stage, merged over `shared`. `false` skips the stage. |
| `stages` | array | the five above | Stages to run, in the order given. Trim it when a profile needs a subset, or add the generator. |

Each stage's own settings are documented in its README; the keys are unchanged here.

## A filter of the project's own

A `stages` entry can name a script instead of a stage, and it runs at that point in the order —
for a step that belongs mid-stack and is not one of this repository's filters. The path is
relative to the project root, the way a local filter definition's `script` is.

```jsonc
{
  "filter": "core",
  "settings": {
    "shared": { "namespace": "core" },
    "stages": [
      "guides",
      "i18n",
      "ui-compile",
      { "script": "./filters/references.mts" },
      "bundler"
    ]
  }
}
```
