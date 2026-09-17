# manifest

Keep one committed manifest per build shape and let the profile pick. `manifest.json` is what
ships; a variant such as `manifest.test.json` extends it and adds whatever that build shape needs
— `extends` works the way `tsconfig.json` trained everyone to expect, merging key by key while
arrays and scalars replace outright. The resolved manifest must be a `format_version` 3 manifest.

## Install

```bash
regolith install github.com/bedrock-core/regolith-filters/manifest
```

```jsonc
{
  "regolith": {
    "profiles": {
      "default": {
        "filters": [{ "filter": "manifest" }, { "filter": "bundler" }]
      },
      "test": {
        "filters": [
          { "filter": "manifest", "settings": { "manifestPath": "BP/manifest.test.json" } },
          { "filter": "bundler", "settings": { "tsConfigPath": "tsconfig.test.json" } }
        ]
      }
    }
  }
}
```

The profile picks a manifest the same way it picks an entry point. Every run sweeps `BP/` and
`RP/` for `manifest.*.json` variants and deletes them so they never ship.

## Documentation

https://bedrock-core.drav.dev/docs/filters/manifest
