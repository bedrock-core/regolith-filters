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
    prefix: 'demo.guides',
    maxCodeLineBytes: 60,
    report,
  });
  const manifest = buildManifest({
    build: localeBuild,
    categories,
    prefix: 'demo.guides',
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
      labelK: 'demo.guides._cat.getting_started',
      collapsed: true,
      link: 'getting-started/installation',
    });
    expect(cat.children.map((n) => n.id)).toEqual([
      'getting-started/installation',
      'getting-started/first-screen',
    ]);
    expect(lang.get('demo.guides._cat.getting_started')).toBe('Getting Started');
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

  it('emits no admonition title keys (owned by @bedrock-core/guides typed resources)', () => {
    const { lang } = build();
    expect([...lang.keys()].some(k => k.includes('_adm'))).toBe(false);
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
    expect(intro.descK).toBe('demo.guides.intro._desc');
    expect(lang.get('demo.guides.intro._desc')).toBe('§7Start here.');

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

describe('buildManifest access', () => {
  // intro (public) -> ops (op) -> admin/* (op via its category) -> faq (public), so both
  // chains have to skip over something.
  const page = (...lines) => ['---', ...lines, '---', '', 'Text.', ''].join('\n');

  const GATED = new Map([
    ['intro', page('title: Introduction', 'sidebar_position: 1')],
    ['ops', page('title: Ops', 'sidebar_position: 2', 'access: op')],
    ['admin/tools', page('title: Tools', 'sidebar_position: 1')],
    ['admin/keys', page('title: Keys', 'sidebar_position: 2', 'access: op')],
    ['faq', page('title: FAQ', 'sidebar_position: 4')],
  ]);
  const GATED_CATEGORIES = new Map([['admin', { label: 'Admin', position: 3, access: 'op' }]]);

  const gatedBuild = () => build({ files: GATED, categories: GATED_CATEGORIES });

  it('leaves an ungated guide byte-identical to before the feature', () => {
    const { manifest } = build();

    expect(manifest.gated).toBeUndefined();
    expect(JSON.stringify(manifest)).not.toContain('"a"');
    expect(JSON.stringify(manifest)).not.toContain('pprev');
  });

  it('marks gated pages and categories, and inherits down a gated category', () => {
    const { manifest } = gatedBuild();

    expect(manifest.gated).toBe(true);
    expect(manifest.pages['ops'].a).toBe('op');
    expect(manifest.pages['intro'].a).toBeUndefined();

    // admin/tools declares nothing; its category gates it anyway.
    expect(manifest.pages['admin/tools'].a).toBe('op');
    expect(manifest.pages['admin/keys'].a).toBe('op');

    const cat = manifest.tree.find((n) => n.t === 'cat');
    expect(cat).toMatchObject({ id: 'admin', a: 'op' });
    expect(cat.children.every((n) => n.a === 'op')).toBe(true);
  });

  it('bakes an operator chain over every page and a public chain that skips gated ones', () => {
    const p = gatedBuild().manifest.pages;

    // Operator: intro -> ops -> admin/tools -> admin/keys -> faq
    expect(p['intro'].next).toBe('ops');
    expect(p['ops'].next).toBe('admin/tools');
    expect(p['admin/keys'].next).toBe('faq');

    // Everyone else: intro -> faq, and nothing points into the gated pages.
    expect(p['intro'].pprev).toBeUndefined();
    expect(p['intro'].pnext).toBe('faq');
    expect(p['faq'].pprev).toBe('intro');
    expect(p['faq'].pnext).toBeUndefined();
    expect(p['ops'].pnext).toBeUndefined();
    expect(p['admin/tools'].pprev).toBeUndefined();
  });

  it('keeps a gated category link out of the public chain', () => {
    const categories = new Map([['admin', { label: 'Admin', position: 3, link: 'tools' }]]);
    const files = new Map(GATED).set('admin/tools', page('title: Tools', 'access: op'));
    const p = build({ files, categories }).manifest.pages;

    // The category itself is open, so it is walked - but its landing page is not.
    expect(p['admin/tools'].a).toBe('op');
    expect(p['intro'].pnext).toBe('faq');
  });

  it('warns and ignores an access value it does not understand', () => {
    const files = new Map([['intro', page('title: Introduction', 'access: wizard')]]);
    const { manifest, report } = build({ files, categories: new Map() });

    expect(manifest.pages['intro'].a).toBeUndefined();
    expect(manifest.gated).toBeUndefined();
    expect(report.warnings.some((w) => w.includes('wizard'))).toBe(true);
  });
});
