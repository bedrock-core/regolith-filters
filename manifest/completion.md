# Manifest

A Regolith filter that picks a manifest variant per profile.

`manifest.test.json` extends `manifest.json` with tsconfig's merge rules — objects merge key by
key, arrays replace outright — and the resolved result is written as `manifest.json`. Every
variant is then deleted from the temp workspace, so the gametest build's beta modules can never
reach a release pack.
