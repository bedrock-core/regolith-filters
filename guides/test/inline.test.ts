import { describe, expect, it } from 'vitest';

import { compileInline, resolveInternalLink } from '../lib/inline.ts';
import { parseGuideFile } from '../lib/parse.ts';
import { makeInlineReport } from './helpers.ts';

/** Parse a one-paragraph markdown source and compile its phrasing content. */
function inline(
  source: string,
  { pageIds = new Set<string>(), fromDir = '' }: { pageIds?: Set<string>; fromDir?: string } = {},
): any {
  const { root, getDefinition } = parseGuideFile(source);
  const paragraph = root.children.find((n: any) => n.type === 'paragraph');
  const report = makeInlineReport();
  const result = compileInline(paragraph.children, {
    resolveLink: (url: string) => resolveInternalLink(url, fromDir, pageIds),
    getDefinition,
    warn: report.warn,
    error: report.error,
  });
  return { ...result, report };
}

describe('compileInline', () => {
  it('compiles plain text unchanged', () => {
    expect(inline('Hello world.').text).toBe('Hello world.');
  });

  it('bakes bold and italic with reset-restore across nesting', () => {
    expect(inline('**bold *italic* bold**').text).toBe('§lbold §oitalic§r§l bold§r');
  });

  it('styles inline code with §7', () => {
    expect(inline('run `yarn build` now').text).toBe('run §7yarn build§r now');
  });

  it('restores outer styles after a nested pop', () => {
    expect(inline('**a `code` b**').text).toBe('§la §7code§r§l b§r');
  });

  it('escapes .lang placeholder sequences with a zero-width reset-restore', () => {
    expect(inline('done 100%s of %1 times').text).toBe('done 100%§rs of %§r1 times');
  });

  it('keeps active styles across an escaped placeholder', () => {
    expect(inline('**50%s off**').text).toBe('§l50%§r§ls off§r');
  });

  it('flattens soft line breaks to a single space', () => {
    expect(inline('one\ntwo').text).toBe('one two');
  });

  it('styles external links §3 as plain text — nothing can open a browser from a server form', () => {
    const { text, links } = inline('see [the docs](https://example.com)');
    expect(text).toBe('see §3the docs§r');
    expect(links).toEqual([]);
  });

  it('keeps an internal link in the paragraph, styled §9, with the span its label covers', () => {
    const pageIds = new Set(['getting-started/installation']);
    const { text, links, report } = inline('see [**Install** guide](./installation.mdx)', {
      pageIds,
      fromDir: 'getting-started',
    });
    expect(text).toBe('see §9§lInstall§r§9 guide§r');
    expect(links).toEqual([{ to: 'getting-started/installation', at: [6, 25] }]);
    expect(text.slice(6, 25)).toBe('§lInstall§r§9 guide');
    expect(report.errors).toEqual([]);
  });

  it('breaks anything a <Trans> would read as a tag, keeping the styles around it', () => {
    const { text } = inline('use `<Text>` here');
    expect(text).toBe('use §7<§r§7Text>§r here');
  });

  it('reports broken internal links as errors and renders them as plain styled text', () => {
    const { text, links, report } = inline('see [missing](./nope.md)');
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]).toContain('./nope.md');
    expect(text).toBe('see §3missing§r');
    expect(links).toEqual([]);
  });

  it('resolves reference-style links through definitions', () => {
    const source = 'see [install][ref]\n\n[ref]: /setup\n';
    const { text, links } = inline(source, { pageIds: new Set(['setup']) });
    expect(text).toBe('see §9install§r');
    expect(links).toEqual([{ to: 'setup', at: [6, 13] }]);
  });
});

describe('resolveInternalLink', () => {
  const ids = new Set(['intro', 'getting-started/installation', 'getting-started/first-screen']);

  it('resolves relative siblings', () => {
    expect(resolveInternalLink('./first-screen.mdx', 'getting-started', ids)).toBe('getting-started/first-screen');
  });

  it('resolves parent-relative paths', () => {
    expect(resolveInternalLink('../intro', 'getting-started', ids)).toBe('intro');
  });

  it('resolves root-absolute paths', () => {
    expect(resolveInternalLink('/getting-started/installation', '', ids)).toBe('getting-started/installation');
  });

  it('returns null for unknown targets, escapes, and anchors', () => {
    expect(resolveInternalLink('./missing', '', ids)).toBeNull();
    expect(resolveInternalLink('../../outside', 'getting-started', ids)).toBeNull();
    expect(resolveInternalLink('#section', '', ids)).toBeNull();
  });

  it('ignores anchors and queries on resolvable targets', () => {
    expect(resolveInternalLink('./installation.md#step-2', 'getting-started', ids)).toBe('getting-started/installation');
  });
});
