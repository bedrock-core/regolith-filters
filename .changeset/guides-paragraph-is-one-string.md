---
'@bedrock-core/regolith-filters_guides': minor
---

**Breaking.** A paragraph and a list item compile to one styled string rather than one key per run split at every internal link, and keys lose their `.r<M>` suffix. One without internal links keeps its key. One with internal links has no key: the manifest carries it as a tagged string in every locale, `See <0>the page</0>.`, with the pages its numbered tags open, for the ui's `<Trans>` to draw. A tag's number is its page's place among the default locale's links, so a translation may reorder them. Text that would read as a tag is broken with a zero-width code so it draws as written.
