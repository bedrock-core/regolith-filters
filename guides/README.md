# guides

Regolith filter that compiles **MDX guide content** into two build artifacts consumed by
[`@bedrock-core/guides`](https://github.com/bedrock-core/ui):

1. **A guide IR manifest** — `data/guides/guides.generated.json`, written in Regolith's temp
   workspace (never synced back to the project) and imported in scripts as
   `@bedrock-core/generated/guides` (sidebar tree, pages, prev/next chain, block IR). The
   bundler resolves the `packs/data` alias against the temp workspace and inlines the JSON —
   nothing generated ever lands in the project source tree.
2. **Auto-localized `.lang` entries** — every heading, paragraph, list item, link label and
   admonition title becomes a localization key appended to `RP/texts/<locale>.lang` in a
   marker-delimited section. Long prose therefore rides `.lang` values (the runtime's 80-byte
   raw-text cap never applies) and the **client resolves text per player language for free**.

```
packs/data/guides/
├── guides.generated.d.ts       ← seeded by `regolith install`; commit it
├── en_US/                      ← defaultLocale: structure, keys, sidebar, fallbacks
│   ├── intro.mdx
│   └── getting-started/
│       ├── _category_.json     ← Docusaurus-style: label / position / collapsed / link / icon / access
│       ├── installation.mdx
│       └── first-screen.mdx
└── es_ES/                      ← translations: same tree, values only
    └── intro.mdx
```

Content and generated artifacts share one folder: the locale directories are your source, and the
`.d.ts` (plus the `.json` manifest each run writes into the temp workspace) sit beside them. Only
directories are read as locales, so the generated files never look like content.

## Usage

```json
"filterDefinitions": {
  "guides": { "url": "github.com/bedrock-core/regolith-filters", "version": "1.0.0" }
},
"profiles": {
  "default": {
    "filters": [
      { "filter": "guides", "settings": { "namespace": "creator_pack" } },
      { "filter": "i18n" },
      { "filter": "bundler" }
    ]
  }
}
```

`namespace` is **required** — the filter aborts without it. Use your addon namespace, the same
`<creator>_<pack>` join the i18n filter derives from `core.register({ creator, pack })` and the
server runtime's `addonNamespace()` builds at startup, so every key your pack emits sits under
one prefix.

**Ordering is mandatory: `guides` → `i18n` → `bundler`.** guides writes `.lang`
entries *before* the i18n filter carries them into its bundle's passthrough, which is how
guide keys reach the runtime's text-measurement context; the bundler then inlines both generated
modules.

Add the tsconfig path so the bundler resolves the generated module against the temp workspace
during a run. On real disk the `.json` never exists — the shipped
`packs/data/guides/guides.generated.d.ts` (seeded by `regolith install`; commit it) types the
module, so the project typechecks without ever running a build (make sure `packs/data/**/*` is
in `include` so the declaration loads):

```json
"paths": {
  "@bedrock-core/generated/guides": ["./packs/data/guides/guides.generated.json"]
}
```

Then render it:

```tsx
import guides from '@bedrock-core/generated/guides';
import { createGuide } from '@bedrock-core/guides';

// Build once, host behind a single navigator screen:
const Guide = createGuide(guides, { title: 'My Addon' });
// <Guide onExit={() => navigation.goBack()} />
```

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `namespace` | — (**required**) | Addon namespace in generated keys: `<namespace>.guides.*` |
| `sourceDir` | `data/guides` | Content root; direct child *directories* are locale folders |
| `defaultLocale` | `en_US` | Locale defining structure, keys, sidebar, and fallback values |
| `include` / `exclude` | `**/*.md`, `**/*.mdx` / `[]` | Page selection globs per locale folder |
| `manifestPath` | `data/guides/guides.generated.json` | Manifest output path (temp workspace; consumed by the bundler, never synced back) |
| `maxCodeLineBytes` | `60` | Hard-wrap budget for code-block lines (raw text, 80-byte cap) |
| `strictLocales` | `false` | Fail instead of warn on cross-locale key drift |

## Authoring

Markdown/MDX subset supported in v1 (parsed with remark + remark-gfm + remark-directive +
remark-mdx — both `.md` and `.mdx` run through the same MDX-enabled pipeline, so escape literal
`<` as `\<`):

- **Headings** `#`–`###` (deeper clamps to 3). A leading `# H1` is the page title and is taken
  out of the body — the page header renders it. Frontmatter `title` wins over it for the value,
  but the h1 comes out either way: `title:` names the page for the sidebar and the header, it is
  never content. Only a LEADING h1 is treated this way; one further down stays put.
- **Frontmatter**: `title`, `sidebar_position`, `hidden` (compiled but out of sidebar/pagination),
  `icon` (RP texture path shown as the sidebar row thumbnail; ≤80 chars), `description` (a
  one-line, localized subtitle under the row title — kept short), `home` (see below), `access`
  (see below).
- **`home: true`** makes that page the one the guide opens on, instead of its sidebar — for when
  the sidebar is not the introduction you would have written. The sidebar stays one press away
  while there is more than one page; a single-page guide drops it entirely, with or without
  `home`. Pairs naturally with `hidden: true`, since a landing page is usually not also a sidebar
  row. Two pages claiming it is a warning, not an error: the first in document order wins.
- **`access: op`** keeps a page for world operators. Set it on a page's frontmatter, or on a
  `_category_.json` to gate that whole section — access inherits downward and a child cannot
  widen it back out. The renderer resolves the sidebar, landing page, prev/next chain, and
  inline links per audience, so a non-operator sees a guide that reads as if the gated pages
  were never written. Presentation, not protection: the manifest replicates world-wide and the
  prose ships in the pack's `.lang`.
- **Inline styles** baked into `.lang` values as `§` codes: `**bold**`→`§l`, `*italic*`→`§o`,
  `` `code` ``→`§7`, `~~strike~~`→`§8` (dim — Bedrock has no strikethrough), links→`§9`.
- **Links**: internal links (`./page.mdx`, `../intro`, `/abs/page`) are validated at build time
  (broken = build error) and rendered as pressable link buttons under the paragraph. External
  `http(s)` links render as styled text only.
- **Lists** (`-`/`1.`), one nesting level rendered indented.
- **Images**: `![alt](textures/ui/my_image.png)` → RP texture path (extension stripped); PNG
  dimensions are sniffed for aspect-ratio rendering.
- **Admonitions**: `:::note|tip|info|warning|danger` (+ `[Custom Title]`), `caution`→`warning`,
  blockquotes render as `note`.
- **Code blocks**: raw, un-localized, hard-wrapped at `maxCodeLineBytes`.
- **MDX components** `<Name prop="x" n={1} flag />` are carried as IR `cmp` nodes (literal props
  only). Rendering them requires a component registry — see `@bedrock-core/guides` (planned
  Phase 3); unregistered names render an "unsupported content" placeholder.
- **Not supported in v1**: tables (warn+skip), inline images, footnotes, raw HTML,
  `import`/`export` in MDX, hard line breaks inside a paragraph.

## Localization model

- The **default locale is the single source of structural truth**: it defines the page set, key
  set, sidebar and prev/next. Other locales contribute *values only*.
- Keys are **structural** (`<ns>.guides.<page_path>.<b0|b1.i2|…>`, category labels under
  `<ns>.guides._cat.<dir_path>`): the same deterministic walk runs
  over every locale, so identical document structure pairs keys positionally. Editing a page
  reshuffles indices — that costs nothing because the `.lang` section is fully regenerated and
  translators edit the per-locale MDX, never the `.lang`.
- Every locale's generated section contains the **complete default-locale key set**; untranslated
  keys are filled with default-locale values (parity drift is reported; `strictLocales` makes it
  fatal). `RP/texts/languages.json` is updated automatically.
- Category labels come from each locale's own `_category_.json`; admonition default titles
  (Note/Tip/…) are English-only in v1.
- *Known caveat*: server-side text measurement (ellipsis/`maxLines`) uses the default-locale
  strings; actual paragraph wrapping happens client-side per player language and is always
  correct.

## Notes

- This filter is **ESM** (`"type": "module"`) because unified/remark v11+ are ESM-only —
  transparent to Regolith, which just spawns `node ./main.js`.
- Generated `.lang` sections are delimited by `## <core:generated-guides:begin/end>` markers and
  re-running is idempotent; hand-written entries outside the markers are preserved.
- `yarn test` runs the transform unit tests (vitest).
