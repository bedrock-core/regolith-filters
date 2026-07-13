import { describe, expect, it } from 'vitest';

import { wrapCodeLines } from '../lib/compile.js';
import { buildLocale } from '../lib/build.js';
import { makeReport } from './helpers.js';

/** Compile a single page through the real locale build. */
function page(source, { pageId = 'page', imageSize, files = new Map() } = {}) {
  const report = makeReport();
  files.set(pageId, source);
  const build = buildLocale({
    files,
    categories: new Map(),
    prefix: 'bcg.test',
    maxCodeLineBytes: 60,
    imageSize,
    report,
  });
  return { ...build.pages.get(pageId), lang: build.lang, report };
}

describe('block compilation', () => {
  it('compiles headings with clamped levels and paragraph keys in document order', () => {
    const { blocks, lang } = page('# Title\n\n## Section\n\nBody text.\n\n#### Deep\n');
    // leading h1 became the title and was removed
    expect(lang.get('bcg.test.page.title')).toBe('Title');
    expect(blocks).toEqual([
      { t: 'h', l: 2, k: 'bcg.test.page.b0' },
      { t: 'p', runs: [{ k: 'bcg.test.page.b1.r0' }] },
      { t: 'h', l: 3, k: 'bcg.test.page.b2' },
    ]);
    expect(lang.get('bcg.test.page.b1.r0')).toBe('Body text.');
  });

  it('prefers frontmatter title and keeps content headings', () => {
    const { blocks, lang } = page('---\ntitle: Custom\n---\n\n# Kept\n');
    expect(lang.get('bcg.test.page.title')).toBe('Custom');
    expect(blocks).toEqual([{ t: 'h', l: 1, k: 'bcg.test.page.b0' }]);
  });

  it('falls back to a humanized filename title', () => {
    const { lang } = page('Just text.\n', { pageId: 'getting-started/first-screen' });
    expect(lang.get('bcg.test.getting_started.first_screen.title')).toBe('First Screen');
  });

  it('splits a paragraph into text/link runs in document order', () => {
    const files = new Map([['other', '# Other\n']]);
    const { blocks, lang } = page('See [the other page](./other.md).\n', { files });
    expect(blocks[0]).toEqual({
      t: 'p',
      runs: [
        { k: 'bcg.test.page.b0.r0' },
        { k: 'bcg.test.page.b0.r1', to: 'other' },
        { k: 'bcg.test.page.b0.r2' },
      ],
    });
    expect(lang.get('bcg.test.page.b0.r0')).toBe('See ');
    expect(lang.get('bcg.test.page.b0.r1')).toBe('§9the other page');
    expect(lang.get('bcg.test.page.b0.r2')).toBe('.');
  });

  it('compiles nested lists with item and link runs', () => {
    const source = '- first\n- second [link](./page)\n  - nested\n';
    const { blocks, lang } = page(source);
    expect(blocks[0]).toEqual({
      t: 'ul',
      items: [
        { runs: [{ k: 'bcg.test.page.b0.i0.r0' }] },
        {
          runs: [
            { k: 'bcg.test.page.b0.i1.r0' },
            { k: 'bcg.test.page.b0.i1.r1', to: 'page' },
          ],
          items: [{ runs: [{ k: 'bcg.test.page.b0.i1.i0.r0' }] }],
        },
      ],
    });
    expect(lang.get('bcg.test.page.b0.i1.i0.r0')).toBe('nested');
  });

  it('keeps ordered list start offsets', () => {
    const { blocks } = page('3. three\n4. four\n');
    expect(blocks[0].t).toBe('ol');
    expect(blocks[0].start).toBe(3);
  });

  it('compiles admonitions with default and custom titles', () => {
    const source = ':::tip\nUse the CLI.\n:::\n\n:::warning[Careful]\nDanger zone.\n:::\n';
    const { blocks, lang } = page(source);
    expect(blocks[0]).toEqual({
      t: 'adm',
      kind: 'tip',
      blocks: [{ t: 'p', runs: [{ k: 'bcg.test.page.b0.b0.r0' }] }],
    });
    expect(blocks[1]).toEqual({
      t: 'adm',
      kind: 'warning',
      titleK: 'bcg.test.page.b1.t',
      blocks: [{ t: 'p', runs: [{ k: 'bcg.test.page.b1.b0.r0' }] }],
    });
    expect(lang.get('bcg.test.page.b1.t')).toBe('§6§lCareful');
  });

  it('maps caution to warning and blockquotes to note', () => {
    const { blocks } = page(':::caution\nx\n:::\n\n> quoted\n');
    expect(blocks[0].kind).toBe('warning');
    expect(blocks[1]).toEqual({ t: 'adm', kind: 'note', blocks: [{ t: 'p', runs: [{ k: 'bcg.test.page.b1.b0.r0' }] }] });
  });

  it('stores code blocks raw and un-localized', () => {
    const { blocks, lang } = page('```ts\nconst x = 1;\n```\n');
    expect(blocks[0]).toEqual({ t: 'code', lang: 'ts', lines: ['const x = 1;'] });
    expect([...lang.keys()].filter((k) => k.includes('.b0'))).toEqual([]);
  });

  it('turns image-only paragraphs into img blocks with sniffed dimensions', () => {
    const { blocks } = page('![The hub](textures/ui/demo/hub.png)\n', {
      imageSize: (src) => (src === 'textures/ui/demo/hub' ? { w: 32, h: 16 } : undefined),
    });
    expect(blocks[0]).toEqual({ t: 'img', src: 'textures/ui/demo/hub', alt: 'The hub', w: 32, h: 16 });
  });

  it('compiles hr and skips tables with a warning', () => {
    const { blocks, report } = page('---\ntitle: t\n---\n\nabove\n\n***\n\n| a | b |\n| - | - |\n| 1 | 2 |\n');
    expect(blocks).toEqual([
      { t: 'p', runs: [{ k: 'bcg.test.page.b0.r0' }] },
      { t: 'hr' },
    ]);
    expect(report.warnings.some((w) => w.includes('tables'))).toBe(true);
  });

  it('carries MDX components as cmp nodes with literal props', () => {
    const source = '<ItemRenderer item="minecraft:diamond" scale={2} enchanted />\n';
    const { blocks, report } = page(source);
    expect(blocks[0]).toEqual({
      t: 'cmp',
      name: 'ItemRenderer',
      props: { item: 'minecraft:diamond', scale: 2, enchanted: true },
    });
    expect(report.errors).toEqual([]);
  });

  it('warns on non-literal props and import statements', () => {
    const { blocks, report } = page('import X from "y"\n\n<Widget data={someVar} />\n');
    expect(report.warnings.some((w) => w.includes('import/export'))).toBe(true);
    expect(report.warnings.some((w) => w.includes('non-literal'))).toBe(true);
    expect(blocks[0]).toEqual({ t: 'cmp', name: 'Widget' });
  });

  it('reports MDX syntax errors as errors without throwing', () => {
    const { report } = page('broken <tag\n');
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]).toContain('parse error');
  });
});

describe('key stability', () => {
  it('assigns identical keys for structurally identical documents in different languages', () => {
    const en = page('# Title\n\nHello **world**.\n\n- a\n- b\n');
    const es = page('# Título\n\nHola **mundo**.\n\n- uno\n- dos\n');
    expect([...es.lang.keys()]).toEqual([...en.lang.keys()]);
  });
});

describe('wrapCodeLines', () => {
  it('leaves short lines alone', () => {
    expect(wrapCodeLines('const a = 1;', 60)).toEqual(['const a = 1;']);
  });

  it('wraps at the last space inside the byte budget', () => {
    const line = 'aaaa bbbb cccc dddd';
    expect(wrapCodeLines(line, 10)).toEqual(['aaaa bbbb', 'cccc dddd']);
  });

  it('hard-cuts unbreakable runs', () => {
    expect(wrapCodeLines('a'.repeat(25), 10)).toEqual(['a'.repeat(10), 'a'.repeat(10), 'a'.repeat(5)]);
  });

  it('counts UTF-8 bytes, not characters', () => {
    // 'ñ' is 2 bytes — 6 of them (12 bytes) must wrap under a 10-byte budget
    const wrapped = wrapCodeLines('ñ'.repeat(6), 10);
    expect(wrapped).toEqual(['ñ'.repeat(5), 'ñ']);
  });

  it('preserves existing newlines', () => {
    expect(wrapCodeLines('one\ntwo', 60)).toEqual(['one', 'two']);
  });
});
