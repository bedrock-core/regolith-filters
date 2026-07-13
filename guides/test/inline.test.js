import { describe, expect, it } from 'vitest';

import { compileInline, resolveInternalLink } from '../lib/inline.js';
import { parseGuideFile } from '../lib/parse.js';
import { makeInlineReport } from './helpers.js';

/** Parse a one-paragraph markdown source and compile its phrasing content. */
function inline(source, { pageIds = new Set(), fromDir = '' } = {}) {
  const { root, getDefinition } = parseGuideFile(source);
  const paragraph = root.children.find((n) => n.type === 'paragraph');
  const report = makeInlineReport();
  const result = compileInline(paragraph.children, {
    resolveLink: (url) => resolveInternalLink(url, fromDir, pageIds),
    getDefinition,
    warn: report.warn,
    error: report.error,
  });
  return { ...result, report };
}

describe('compileInline', () => {
  it('compiles plain text unchanged', () => {
    expect(inline('Hello world.').runs).toEqual([{ text: 'Hello world.' }]);
  });

  it('bakes bold and italic with reset-restore across nesting', () => {
    expect(inline('**bold *italic* bold**').runs).toEqual([{ text: '§lbold §oitalic§r§l bold§r' }]);
  });

  it('styles inline code with §7', () => {
    expect(inline('run `yarn build` now').runs).toEqual([{ text: 'run §7yarn build§r now' }]);
  });

  it('restores outer styles after a nested pop', () => {
    expect(inline('**a `code` b**').runs).toEqual([{ text: '§la §7code§r§l b§r' }]);
  });

  it('escapes .lang placeholder sequences with a zero-width reset-restore', () => {
    expect(inline('done 100%s of %1 times').runs).toEqual([{ text: 'done 100%§rs of %§r1 times' }]);
  });

  it('keeps active styles across an escaped placeholder', () => {
    expect(inline('**50%s off**').runs).toEqual([{ text: '§l50%§r§ls off§r' }]);
  });

  it('flattens soft line breaks to a single space', () => {
    expect(inline('one\ntwo').runs).toEqual([{ text: 'one two' }]);
  });

  it('styles external links §9 as plain text — nothing can open a browser from a server form', () => {
    const { runs } = inline('see [the docs](https://example.com)');
    expect(runs).toEqual([{ text: 'see §9the docs§r' }]);
  });

  it('splits internal links into their own run, styled §9', () => {
    const pageIds = new Set(['getting-started/installation']);
    const { runs, report } = inline('see [**Install** guide](./installation.mdx)', {
      pageIds,
      fromDir: 'getting-started',
    });
    expect(runs).toEqual([
      { text: 'see ' },
      { text: '§9§lInstall§r§9 guide', to: 'getting-started/installation' },
    ]);
    expect(report.errors).toEqual([]);
  });

  it('reports broken internal links as errors and renders them as plain styled text', () => {
    const { runs, report } = inline('see [missing](./nope.md)');
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]).toContain('./nope.md');
    expect(runs).toEqual([{ text: 'see §9missing§r' }]);
  });

  it('resolves reference-style links through definitions', () => {
    const source = 'see [install][ref]\n\n[ref]: /setup\n';
    const { runs } = inline(source, { pageIds: new Set(['setup']) });
    expect(runs).toEqual([
      { text: 'see ' },
      { text: '§9install', to: 'setup' },
    ]);
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
