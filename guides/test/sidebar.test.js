import { describe, expect, it } from 'vitest';

import { buildLocale, buildManifest } from '../lib/build.js';
import { makeReport } from './helpers.js';

const FIXTURE = new Map([
  ['intro', '---\ntitle: Introduction\nsidebar_position: 1\n---\n\nWelcome!\n'],
  ['faq', '---\ntitle: FAQ\nsidebar_position: 3\n---\n\nQuestions.\n'],
  ['getting-started/installation', '---\ntitle: Installation\nsidebar_position: 1\n---\n\nInstall it.\n'],
  ['getting-started/first-screen', '---\ntitle: First Screen\nsidebar_position: 2\n---\n\nMake one.\n'],
  ['hidden-page', '---\ntitle: Secret\nhidden: true\n---\n\nShh.\n'],
]);

const CATEGORIES = new Map([
  ['getting-started', { label: 'Getting Started', position: 2, collapsed: true, link: 'installation' }],
]);

function build({ files = FIXTURE, categories = CATEGORIES } = {}) {
  const report = makeReport();
  const localeBuild = buildLocale({
    files: new Map(files),
    categories,
    prefix: 'bcg.demo',
    maxCodeLineBytes: 60,
    report,
  });
  const manifest = buildManifest({
    build: localeBuild,
    categories,
    prefix: 'bcg.demo',
    ns: 'demo',
    defaultLocale: 'en_US',
    locales: ['en_US'],
    report,
  });
  return { manifest, lang: localeBuild.lang, report };
}

describe('buildManifest home', () => {
  it('omits home when no page claims it', () => {
    expect(build().manifest.home).toBeUndefined();
  });

  it('takes home from the page whose frontmatter sets it', () => {
    const files = new Map(FIXTURE).set('landing', '---\ntitle: Start\nhome: true\nhidden: true\n---\n\nHi.\n');

    expect(build({ files }).manifest.home).toBe('landing');
  });

  it('uses the first of several claimants and reports the rest', () => {
    const files = new Map(FIXTURE)
      .set('a-landing', '---\ntitle: A\nhome: true\n---\n\nA.\n')
      .set('b-landing', '---\ntitle: B\nhome: true\n---\n\nB.\n');
    const { manifest, report } = build({ files });

    expect(manifest.home).toBe('a-landing');
    expect(report.warnings.join(' ')).toContain('home');
  });
});

describe('buildManifest', () => {
  it('orders the sidebar by position then name, hiding hidden pages', () => {
    const { manifest } = build();
    expect(manifest.tree.map((n) => n.id)).toEqual(['intro', 'getting-started', 'faq']);
    expect(manifest.tree.flatMap((n) => (n.t === 'page' ? [n.id] : []))).not.toContain('hidden-page');
  });

  it('carries category label, collapsed, and resolved link', () => {
    const { manifest, lang } = build();
    const cat = manifest.tree[1];
    expect(cat).toMatchObject({
      t: 'cat',
      id: 'getting-started',
      labelK: 'bcg.demo._cat.getting_started',
      collapsed: true,
      link: 'getting-started/installation',
    });
    expect(cat.children.map((n) => n.id)).toEqual([
      'getting-started/installation',
      'getting-started/first-screen',
    ]);
    expect(lang.get('bcg.demo._cat.getting_started')).toBe('Getting Started');
  });

  it('humanizes category labels when no _category_.json exists', () => {
    const { manifest, lang } = build({ categories: new Map() });
    const cat = manifest.tree.find((n) => n.t === 'cat');
    expect(lang.get(cat.labelK)).toBe('Getting Started');
    expect(cat.collapsed).toBeUndefined();
    expect(cat.link).toBeUndefined();
  });

  it('chains prev/next in DFS order (category link page leads its children)', () => {
    const { manifest } = build();
    const p = manifest.pages;
    expect(p['intro'].prev).toBeUndefined();
    expect(p['intro'].next).toBe('getting-started/installation');
    expect(p['getting-started/installation'].prev).toBe('intro');
    expect(p['getting-started/installation'].next).toBe('getting-started/first-screen');
    expect(p['getting-started/first-screen'].next).toBe('faq');
    expect(p['faq'].next).toBeUndefined();
    // hidden pages stay navigable but out of the chain
    expect(p['hidden-page']).toBeDefined();
    expect(p['hidden-page'].prev).toBeUndefined();
    expect(p['hidden-page'].next).toBeUndefined();
  });

  it('emits default admonition title keys with baked kind colors', () => {
    const { lang } = build();
    expect(lang.get('bcg.demo._adm.tip')).toBe('§a§lTip');
    expect(lang.get('bcg.demo._adm.danger')).toBe('§c§lDanger');
  });

  it('warns and ignores broken category links', () => {
    const categories = new Map([['getting-started', { link: 'nope' }]]);
    const { manifest, report } = build({ categories });
    const cat = manifest.tree.find((n) => n.t === 'cat');
    expect(cat.link).toBeUndefined();
    expect(report.warnings.some((w) => w.includes('nope'))).toBe(true);
  });

  it('carries a page icon and a §7-baked description subtitle key', () => {
    const files = new Map([
      ['intro', '---\ntitle: Introduction\nsidebar_position: 1\nicon: textures/ui/config/guide\ndescription: Start here.\n---\n\nWelcome!\n'],
      ['plain', '---\ntitle: Plain\nsidebar_position: 2\n---\n\nNo extras.\n'],
    ]);
    const { manifest, lang } = build({ files, categories: new Map() });

    const intro = manifest.tree.find((n) => n.id === 'intro');
    expect(intro.icon).toBe('textures/ui/config/guide');
    expect(intro.descK).toBe('bcg.demo.intro._desc');
    expect(lang.get('bcg.demo.intro._desc')).toBe('§7Start here.');

    // A page with neither frontmatter field omits both — the row degrades to text-only.
    const plain = manifest.tree.find((n) => n.id === 'plain');
    expect(plain.icon).toBeUndefined();
    expect(plain.descK).toBeUndefined();
  });

  it('carries a category icon from _category_.json', () => {
    const categories = new Map([['getting-started', { label: 'Getting Started', icon: 'textures/ui/config/home' }]]);
    const { manifest } = build({ categories });
    const cat = manifest.tree.find((n) => n.t === 'cat');
    expect(cat.icon).toBe('textures/ui/config/home');
  });

  it('warns when an icon path exceeds the 80-character serializer limit', () => {
    const longIcon = `textures/ui/${'x'.repeat(80)}`;
    const files = new Map([['intro', `---\ntitle: Introduction\nicon: ${longIcon}\n---\n\nHi.\n`]]);
    const { report } = build({ files, categories: new Map() });
    expect(report.warnings.some((w) => w.includes('80'))).toBe(true);
  });
});
