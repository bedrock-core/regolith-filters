import { describe, expect, it } from 'vitest';

import { wrapCodeLines } from '../lib/compile.ts';
import { buildLocale } from '../lib/build.ts';
import { makeReport } from './helpers.ts';

/** Compile a single page through the real locale build. */
function page(
  source: string,
  {
    pageId = 'page',
    imageSize,
    files = new Map<string, string>(),
  }: { pageId?: string; imageSize?: (src: string) => { w: number; h: number } | undefined; files?: Map<string, string> } = {},
): any {
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
    // the leading h1 names the page and stays in the body as authored
    expect(lang.get('bcg.test.page.title')).toBe('Title');
    expect(blocks).toEqual([
      { t: 'h', l: 1, k: 'bcg.test.page.b0' },
      { t: 'h', l: 2, k: 'bcg.test.page.b1' },
      { t: 'p', k: 'bcg.test.page.b2' },
      { t: 'h', l: 3, k: 'bcg.test.page.b3' },
    ]);
    expect(lang.get('bcg.test.page.b2')).toBe('Body text.');
  });

  it('prefers the frontmatter title for the header, and renders the body as authored', () => {
    const { blocks, lang } = page('---\ntitle: Custom\n---\n\n# Graves\n\nBody.\n');
    expect(lang.get('bcg.test.page.title')).toBe('Custom');
    expect(blocks).toEqual([
      { t: 'h', l: 1, k: 'bcg.test.page.b0' },
      { t: 'p', k: 'bcg.test.page.b1' },
    ]);
    expect(lang.get('bcg.test.page.b1')).toBe('Body.');
  });

  it('leaves a NON-leading h1 alone — only the page title is special', () => {
    const { blocks } = page('---\ntitle: Custom\n---\n\nIntro.\n\n# Later\n');
    expect(blocks).toEqual([
      { t: 'p', k: 'bcg.test.page.b0' },
      { t: 'h', l: 1, k: 'bcg.test.page.b1' },
    ]);
  });

  it('falls back to a humanized filename title', () => {
    const { lang } = page('Just text.\n', { pageId: 'getting-started/first-screen' });
    expect(lang.get('bcg.test.getting_started.first_screen.title')).toBe('First Screen');
  });

  it('keeps a paragraph one string, with the span its link covers', () => {
    const files = new Map([['other', '# Other\n']]);
    const { blocks, lang } = page('See [the other page](./other.md).\n', { files });
    expect(blocks[0]).toEqual({
      t: 'p',
      k: 'bcg.test.page.b0',
      links: [{ to: 'other', at: [6, 20] }],
    });
    expect(lang.get('bcg.test.page.b0')).toBe('See §9the other page§r.');
  });

  it('compiles nested lists, each item one string with its link spans', () => {
    const source = '- first\n- second [link](./page)\n  - nested\n';
    const { blocks, lang } = page(source);
    expect(blocks[0]).toEqual({
      t: 'ul',
      items: [
        { k: 'bcg.test.page.b0.i0' },
        {
          k: 'bcg.test.page.b0.i1',
          links: [{ to: 'page', at: [9, 13] }],
          items: [{ k: 'bcg.test.page.b0.i1.i0' }],
        },
      ],
    });
    expect(lang.get('bcg.test.page.b0.i1')).toBe('second §9link§r');
    expect(lang.get('bcg.test.page.b0.i1.i0')).toBe('nested');
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
      blocks: [{ t: 'p', k: 'bcg.test.page.b0.b0' }],
    });
    expect(blocks[1]).toEqual({
      t: 'adm',
      kind: 'warning',
      titleK: 'bcg.test.page.b1.t',
      blocks: [{ t: 'p', k: 'bcg.test.page.b1.b0' }],
    });
    expect(lang.get('bcg.test.page.b1.t')).toBe('§6§lCareful');
  });

  it('maps caution to warning and blockquotes to note', () => {
    const { blocks } = page(':::caution\nx\n:::\n\n> quoted\n');
    expect(blocks[0].kind).toBe('warning');
    expect(blocks[1]).toEqual({ t: 'adm', kind: 'note', blocks: [{ t: 'p', k: 'bcg.test.page.b1.b0' }] });
  });

  it('stores code blocks raw and un-localized', () => {
    const { blocks, lang } = page('```ts\nconst x = 1;\n```\n');
    expect(blocks[0]).toEqual({ t: 'code', lang: 'ts', lines: ['const x = 1;'] });
    expect([...lang.keys()].filter((k) => k.includes('.b0'))).toEqual([]);
  });

  it('turns image-only paragraphs into img blocks with sniffed dimensions', () => {
    const { blocks } = page('![The hub](textures/ui/demo/hub.png)\n', {
      imageSize: (src: string) => (src === 'textures/ui/demo/hub' ? { w: 32, h: 16 } : undefined),
    });
    expect(blocks[0]).toEqual({ t: 'img', src: 'textures/ui/demo/hub', alt: 'The hub', w: 32, h: 16 });
  });

  it('compiles hr and skips tables with a warning', () => {
    const { blocks, report } = page('---\ntitle: t\n---\n\nabove\n\n***\n\n| a | b |\n| - | - |\n| 1 | 2 |\n');
    expect(blocks).toEqual([
      { t: 'p', k: 'bcg.test.page.b0' },
      { t: 'hr' },
    ]);
    expect(report.warnings.some((w: string) => w.includes('tables'))).toBe(true);
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
    expect(report.warnings.some((w: string) => w.includes('import/export'))).toBe(true);
    expect(report.warnings.some((w: string) => w.includes('non-literal'))).toBe(true);
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
