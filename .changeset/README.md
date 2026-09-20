# Changesets

This folder is managed by [Changesets](https://github.com/changesets/changesets).
It tracks pending version bumps and changelog entries for the seven filters. Every filter is a
private package: it is versioned here and released as a git tag, never published to npm.

## Authoring a changeset

When you make a change worth releasing, run:

```sh
npm run changeset
```

Pick the filters it touches (`@bedrock-core/regolith-filters_<filter>`), a bump level
(`patch` / `minor` / `major`), write a short summary, and commit the generated
`.changeset/<name>.md` alongside your change.

## How releasing works

Versioning is automatic; tagging is manual. The **Release** workflow
(`.github/workflows/release.yml`) has two jobs:

- **On every push to `main`**, if changesets are pending, it opens (or refreshes) a
  **"Version Packages"** PR built by `npm run version-packages`, which consumes the pending
  changesets, bumps each filter's `package.json`, writes its `CHANGELOG.md` and refreshes every
  lockfile. Nothing is tagged from a push.
- **When run by hand** on `main` (Actions → Release → Run workflow), it refuses while changesets
  are still pending, then runs `npm run release`: every filter whose version has no tag yet is
  tagged `<filter>-<version>` and gets a GitHub release from that version's changelog.

`<filter>-<version>` is the tag Regolith checks out for a `filterDefinitions` entry that names
this repository and that version. So a release is: merge the Version PR, then trigger the
workflow.

One repo setting the workflow depends on: *Allow GitHub Actions to create and approve pull
requests* (Settings → Actions → General). Without it the Version PR cannot be opened.
