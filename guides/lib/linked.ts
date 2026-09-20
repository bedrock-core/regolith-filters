// Paragraphs with links, carried in every language rather than under a key.
//
// A paragraph whose links have to be pressable is drawn with the ui's `<Trans>`:
// the ui-compiler breaks it into lines per language and draws it through keys
// it mints for the pieces, so its own key is never drawn. Such a paragraph (or
// list item) travels in the manifest as a tagged string in every language —
// `See <0>the page</0>.` — and the pages its tags open, by index; its key is
// taken out of every `.lang`. A language that did not translate it gets the
// default language's text, as its key would have fallen back to.

/** A link's target and the characters `[start, end)` of its paragraph it covers. */
export interface LinkSpan {
  to: string;
  at: [number, number];
}

/** An inline object of the IR: a paragraph block or a list item. */
type Inline = { k?: unknown; links?: unknown; text?: unknown };

/** Every object under `node` that carries a key, depth first. */
function eachKeyed(node: unknown, visit: (inline: Inline & { k: string }) => void): void {
  if (Array.isArray(node)) {
    for (const child of node) eachKeyed(child, visit);
    return;
  }

  if (typeof node !== 'object' || node === null) return;

  const inline = node as Inline;

  if (typeof inline.k === 'string') visit(inline as Inline & { k: string });

  for (const value of Object.values(node)) {
    if (typeof value === 'object' && value !== null) eachKeyed(value, visit);
  }
}

/** The link spans of every keyed object in one language's pages, by key: none for one without links. */
export function linksByKey(pages: Map<string, any> | Record<string, any>): Map<string, LinkSpan[]> {
  const found = new Map<string, LinkSpan[]>();
  const all = pages instanceof Map ? [...pages.values()] : Object.values(pages);

  eachKeyed(all, (inline) => {
    found.set(inline.k, Array.isArray(inline.links) ? (inline.links as LinkSpan[]) : []);
  });

  return found;
}

/**
 * `text` with each span wrapped in the tag of its target's index in `targets`.
 * A span to a page `targets` does not have stays text.
 */
export function tagLinks(text: string, spans: readonly LinkSpan[], targets: readonly string[]): string {
  let tagged = text;

  for (const span of [...spans].sort((a, b) => b.at[0] - a.at[0])) {
    const index = targets.indexOf(span.to);

    if (index === -1) continue;

    const [start, end] = span.at;

    tagged = `${tagged.slice(0, start)}<${index}>${tagged.slice(start, end)}</${index}>${tagged.slice(end)}`;
  }

  return tagged;
}

/**
 * Rewrites every paragraph and list item of `pages` that has links to carry its
 * tagged text in every language and the pages its tags open, and takes its key
 * out of every language's strings.
 *
 * @param pages - The manifest's pages, rewritten in place.
 * @param lang - Each language's strings, already filled from the default language; edited in place.
 * @param links - Each language's link spans, by key, from that language's own build.
 * @param defaultLocale - The language whose links an untranslated paragraph keeps, and whose order numbers the tags.
 * @returns How many paragraphs were rewritten.
 */
export function inlineLinkedText(
  pages: Record<string, any>,
  lang: Map<string, Map<string, string>>,
  links: Map<string, Map<string, LinkSpan[]>>,
  defaultLocale: string,
): number {
  let rewritten = 0;

  eachKeyed(Object.values(pages), (inline) => {
    if (!Array.isArray(inline.links) || inline.links.length === 0) return;

    const key = inline.k;
    const fallback = inline.links as LinkSpan[];
    const targets = [...new Set(fallback.map(span => span.to))];
    const text: Record<string, string> = {};

    for (const [locale, strings] of lang) {
      const value = strings.get(key) ?? lang.get(defaultLocale)?.get(key) ?? '';

      text[locale] = tagLinks(value, links.get(locale)?.get(key) ?? fallback, targets);
    }

    for (const strings of lang.values()) strings.delete(key);

    const rewrite: Inline = inline;

    delete rewrite.k;
    rewrite.text = text;
    rewrite.links = targets;
    rewritten += 1;
  });

  return rewritten;
}
