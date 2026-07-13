# guides

Regolith filter that compiles **MDX guide content** into two build artifacts consumed by
[`@bedrock-core/guides`](https://github.com/bedrock-core/ui):

1. **A guide IR manifest** — `data/guides/guides.generated.json`, imported in scripts as
   `@bedrock-core/generated/guides` (sidebar tree, pages, prev/next chain, block IR).
2. **Auto-localized `.lang` entries** — every heading, paragraph, list item, link label and
   admonition title becomes a localization key appended to `RP/texts/<locale>.lang` in a
   marker-delimited section. Long prose therefore rides `.lang` values (the runtime's 80-byte
   raw-text cap never applies) and the **client resolves text per player language for free**.

```
packs/data/guide/
├── en_US/                      ← defaultLocale: structure, keys, sidebar, fallbacks
│   ├── intro.mdx
│   └── getting-started/
│       ├── _category_.json     ← Docusaurus-style: label / position / collapsed / link
│       ├── installation.mdx
│       └── first-screen.mdx
└── es_ES/                      ← translations: same tree, values only
    └── intro.mdx
```

## Usage

```json
"filterDefinitions": {
  "guides": { "url": "github.com/bedrock-core/regolith-filters", "version": "1.0.0" }
},
"profiles": {
  "default": {
    "filters": [
      { "filter": "guides", "settings": { "keyPrefix": "my_addon" } },
      { "filter": "translation-keys" },
      { "filter": "bundler" }
    ]
  }
}
```

**Ordering is mandatory: `guides` → `translation-keys` → `bundler`.** guides writes `.lang`
entries *before* translation-keys merges them into `translationKeys.generated.json`, which is how
guide keys reach the runtime's text-measurement context; the bundler then inlines both generated
modules.

Add the tsconfig path so TypeScript resolves the generated module (the shipped
`packs/data/guides/guides.generated.d.ts` provides its types):

```json
"paths": {
  "@bedrock-core/generated/guides": ["./packs/data/guides/guides.generated.json"]
}
```

Then render it:

```tsx
import guides from '@bedrock-core/generated/guides';
import { GuideApp } from '@bedrock-core/guides';

render(<GuideApp manifest={guides} />, player);
```

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `keyPrefix` | — (**required**) | Addon namespace in generated keys: `bcg.<keyPrefix>.*` |
| `sourceDir` | `data/guide` | Content root; direct children are locale folders |
| `defaultLocale` | `en_US` | Locale defining structure, keys, sidebar, and fallback values |
| `include` / `exclude` | `**/*.md`, `**/*.mdx` / `[]` | Page selection globs per locale folder |
| `manifestPath` | `data/guides/guides.generated.json` | Manifest output path |
| `maxCodeLineBytes` | `60` | Hard-wrap budget for code-block lines (raw text, 80-byte cap) |
| `strictLocales` | `false` | Fail instead of warn on cross-locale key drift |

## Authoring

Markdown/MDX subset supported in v1 (parsed with remark + remark-gfm + remark-directive +
remark-mdx — both `.md` and `.mdx` run through the same MDX-enabled pipeline, so escape literal
`<` as `\<`):

- **Headings** `#`–`###` (deeper clamps to 3). A leading `# H1` becomes the page title unless
  frontmatter `title` is set (then it stays in the body).
- **Frontmatter**: `title`, `sidebar_position`, `hidden` (compiled but out of sidebar/pagination).
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
- Keys are **structural** (`bcg.<ns>.<page_path>.<b0|b1.i2|…>`): the same deterministic walk runs
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
- Generated `.lang` sections are delimited by `## <bcg:generated-guides:begin/end>` markers and
  re-running is idempotent; hand-written entries outside the markers are preserved.
- `yarn test` runs the transform unit tests (vitest).
