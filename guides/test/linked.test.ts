import { describe, expect, it } from 'vitest';
import { inlineLinkedText, linksByKey, tagLinks, type LinkSpan } from '../lib/linked.ts';

const lang = (entries: Record<string, Record<string, string>>): Map<string, Map<string, string>> =>
  new Map(Object.entries(entries).map(([locale, strings]) => [locale, new Map(Object.entries(strings))]));

describe('paragraphs with links', () => {
  it('carries a linked paragraph as a tagged string in every language and drops its key from every language', () => {
    const pages = {
      intro: {
        blocks: [
          { t: 'p', k: 'g.intro.b0', links: [{ to: 'setup', at: [6, 11] }] },
          { t: 'p', k: 'g.intro.b1' },
        ],
      },
    };
    const strings = lang({
      en_US: { 'g.intro.b0': 'see §9setup§r', 'g.intro.b1': 'plain' },
      es_ES: { 'g.intro.b0': 'mira §9ajustes§r', 'g.intro.b1': 'llano' },
    });
    const links = new Map<string, Map<string, LinkSpan[]>>([
      ['en_US', linksByKey(pages)],
      ['es_ES', new Map([['g.intro.b0', [{ to: 'setup', at: [7, 14] as [number, number] }]], ['g.intro.b1', []]])],
    ]);

    expect(inlineLinkedText(pages, strings, links, 'en_US')).toBe(1);
    expect(pages.intro.blocks[0]).toEqual({
      t: 'p',
      text: { en_US: 'see §9<0>setup</0>§r', es_ES: 'mira §9<0>ajustes</0>§r' },
      links: ['setup'],
    });
    expect(pages.intro.blocks[1]).toEqual({ t: 'p', k: 'g.intro.b1' });
    expect([...strings.values()].every(table => !table.has('g.intro.b0') && table.has('g.intro.b1'))).toBe(true);
  });

  it('gives a language that did not translate a paragraph the default language\'s links', () => {
    const pages = { a: { blocks: [{ t: 'ul', items: [{ k: 'g.a.b0.i0', links: [{ to: 'b', at: [2, 5] }] }] }] } };
    const strings = lang({ en_US: { 'g.a.b0.i0': '§9bee§r' }, es_ES: { 'g.a.b0.i0': '§9bee§r' } });
    const links = new Map<string, Map<string, LinkSpan[]>>([['en_US', linksByKey(pages)], ['es_ES', new Map()]]);

    inlineLinkedText(pages, strings, links, 'en_US');

    expect(pages.a.blocks[0]?.items[0]).toEqual({ text: { en_US: '§9<0>bee</0>§r', es_ES: '§9<0>bee</0>§r' }, links: ['b'] });
  });
});

describe('tagLinks', () => {
  it('numbers each tag by its page, so a language may reorder its links', () => {
    expect(tagLinks('b then a', [{ to: 'b', at: [0, 1] }, { to: 'a', at: [7, 8] }], ['a', 'b'])).toBe('<1>b</1> then <0>a</0>');
  });

  it('leaves a link to a page the default language does not link as text', () => {
    expect(tagLinks('see c', [{ to: 'c', at: [4, 5] }], ['a'])).toBe('see c');
  });
});
