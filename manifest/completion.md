# Manifest

A Regolith filter that picks a manifest variant per profile.

Settings:

- `manifestPath` (string or string[], default `"BP/manifest.json"`) — manifest(s) to resolve
- `pretty` (false or `{ indent?: "tab" | "space", size?: number }`, default false) — how the resolved manifest is laid out; absent or false writes it minified

`manifest.test.json` extends `manifest.json` with tsconfig's merge rules — objects merge key by
key, arrays replace outright — and the resolved result is written as `manifest.json`. Every
variant is then deleted from the temp workspace, so the gametest build's beta modules can never
reach a release pack.
