# Manifest

Keep one committed manifest per build shape and let the profile pick. `manifest.json` is what
ships; `manifest.test.json` extends it and adds the beta modules the gametest build needs.

`extends` works the way `tsconfig.json` trained everyone to expect.

## Install

```bash
regolith install github.com/bedrock-core/regolith-filters/manifest
```

```jsonc
{
  "regolith": {
    "filterDefinitions": {
      "manifest": {
        "url": "github.com/bedrock-core/regolith-filters",
        "version": "1.0.0"
      }
    },
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

The profile picks a manifest the same way it picks an entry point. Nothing else changes.

## The files

```text
packs/BP/manifest.json        what ships. stable modules only
packs/BP/manifest.test.json   extends it, adds @minecraft/server-gametest
```

```jsonc
// packs/BP/manifest.test.json
{
  "extends": "./manifest.json",
  "header": { "name": "DEV pack" },
  "dependencies": [
    { "uuid": "5e0e2a5b-74e2-4dd6-9c11-8a4f3f6b2d90", "version": [0, 1, 0] },
    { "module_name": "@minecraft/server", "version": "2.9.0-beta" },
    { "module_name": "@minecraft/server-gametest", "version": "1.0.0-beta" }
  ]
}
```

The base stays release-truth, and variants add to it. That way a filter that never ran, or ran
wrong, gives you a broken test build — never a release with beta modules in it.

## Merge rules

TypeScript's, exactly:

- Objects merge key by key, recursively. `header: { name }` overrides the name and keeps the uuid.
- **Arrays and scalars replace outright.** `dependencies` in the child becomes the whole list, so
  restating it is how a variant adds, re-versions or drops an entry.
- `extends` is a relative path resolved against the file that declares it, and chains as deep as
  you like: `manifest.test.json` -> `manifest.dev.json` -> `manifest.json`.

## Settings

| setting | default | meaning |
| --- | --- | --- |
| `manifestPath` | `"BP/manifest.json"` | Manifest to resolve. Pass an array to resolve one per pack. |

Paths are relative to Regolith's temp workspace; a leading `packs/` is stripped, so
`packs/BP/manifest.test.json` and `BP/manifest.test.json` both work.

The result is always written as `manifest.json` beside its source — Bedrock accepts no other name.

## More than one pack

A build shape that changes both manifests names both, in one array:

```jsonc
{
  "filter": "manifest",
  "settings": { "manifestPath": ["BP/manifest.test.json", "RP/manifest.test.json"] }
}
```

Each entry resolves independently and is written as `manifest.json` beside its own source, so the
RP variant can add `capabilities`, retitle the pack for a dev build, or pull in an extra
dependency, while the BP variant does its own thing. Variant filenames need not match across
packs — `BP/manifest.test.json` and `RP/manifest.debug.json` are fine together.

To vary only one pack, name only that one. A manifest with no `extends` is a no-op to resolve, and
the sweep covers both pack roots regardless of which ones were named.

**Do not list the filter twice in a profile.** Every run sweeps the variants in `BP/` and `RP/`, so
the first run deletes what the second one was going to read. One entry, one array.

## Variants never ship

After resolving, every `manifest.*.json` left in `BP/` and `RP/` is deleted from the temp
workspace. Both pack roots are swept even when the profile named only one of them, so an RP
variant can't ride along into a release. `manifest.json` itself, and files that merely look close
(`manifest.json.bak`), are left alone.

Nothing is written until every entry has resolved and validated, so a broken `extends` chain
leaves the workspace exactly as it was.

## Non-goals

It edits nothing it was not asked to. No UUID generation, no script-module injection, no
`launch.json`, no version stamping — the manifest you wrote is the manifest you get, plus
whatever the variant says.

## Tests

```bash
node --test "test/**/*.test.js"
```

They drive `main.js` the way Regolith does: `ROOT_DIR` set, a temp working directory holding
`BP/` and `RP/`, settings as `argv[2]`.
