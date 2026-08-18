// The BP side of the .lang emit. A pack's manifest header.name/description are
// translation keys Bedrock resolves from THAT pack's own texts/<locale>.lang,
// so the behavior pack needs the addon's `meta.*` strings in its own file —
// and only those.
//
// The end-to-end cases drive main.js exactly as Regolith does (ROOT_DIR + a
// working directory holding RP/, BP/ and data/), with `vanilla: false` so the
// run stays offline.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import { manifestAliasEntries, parseLang, selectMetaEntries, stripGeneratedSection } from '../lib/lang.js';

const MAIN = fileURLToPath(new URL('../main.js', import.meta.url));
const NAMESPACE = 'drav0011_shop';

let root;

afterEach(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true });
  root = undefined;
});

/** A Regolith-shaped temp project: ROOT_DIR plus the temp workspace under it. */
function scaffold(resources, files = {}) {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-bp-'));
  const work = path.join(root, 'tmp');
  fs.mkdirSync(path.join(work, 'data', 'i18n'), { recursive: true });
  fs.writeFileSync(path.join(work, 'data', 'i18n', 'en_US.ts'), `export default ${resources} as const;\n`, 'utf-8');
  for (const [relPath, content] of Object.entries(files)) {
    const abs = path.join(work, relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf-8');
  }
  return work;
}

function run(work) {
  return execFileSync(process.execPath, [MAIN, JSON.stringify({ namespace: NAMESPACE, vanilla: false })], {
    cwd: work,
    env: { ...process.env, ROOT_DIR: root },
    encoding: 'utf-8',
  });
}

const read = (work, relPath) => fs.readFileSync(path.join(work, relPath), 'utf-8');
const exists = (work, relPath) => fs.existsSync(path.join(work, relPath));

const WITH_META = `{
  meta: { name: 'Shop', description: 'Sells items', creator: 'DrAv0011' },
  shop: { title: 'Shop', bought: 'You bought {{item}}' },
}`;

describe('selectMetaEntries', () => {
  it('keeps the addon\'s own meta branch and nothing else', () => {
    const entries = new Map([
      [`${NAMESPACE}.meta.name`, 'Shop'],
      [`${NAMESPACE}.meta.description`, 'Sells items'],
      [`${NAMESPACE}.shop.title`, 'Shop'],
      [`${NAMESPACE}.metadata.title`, 'Not meta'],
    ]);
    expect([...selectMetaEntries(entries, NAMESPACE).keys()].sort())
      .toEqual([`${NAMESPACE}.meta.description`, `${NAMESPACE}.meta.name`]);
  });

  it('never picks up a library\'s keys, meta branch or not', () => {
    const entries = new Map([['core.meta.name', 'Core'], ['core.addons.title', 'Addons']]);
    expect(selectMetaEntries(entries, NAMESPACE).size).toBe(0);
  });

  it('is empty when the addon declares no meta branch', () => {
    expect(selectMetaEntries(new Map([[`${NAMESPACE}.shop.title`, 'Shop']]), NAMESPACE).size).toBe(0);
  });
});

describe('manifestAliasEntries', () => {
  it('mirrors name/description onto the literal keys Bedrock resolves', () => {
    const entries = new Map([
      [`${NAMESPACE}.meta.name`, 'Shop'],
      [`${NAMESPACE}.meta.description`, 'Sells items'],
      [`${NAMESPACE}.meta.creator`, 'DrAv0011'],
      [`${NAMESPACE}.shop.title`, 'Shop'],
    ]);
    expect([...manifestAliasEntries(entries, NAMESPACE)]).toEqual([
      ['pack.name', 'Shop'],
      ['pack.description', 'Sells items'],
    ]);
  });

  it('aliases only what is declared', () => {
    const entries = new Map([[`${NAMESPACE}.meta.creator`, 'DrAv0011']]);
    expect(manifestAliasEntries(entries, NAMESPACE).size).toBe(0);
    expect(manifestAliasEntries(new Map([['core.meta.name', 'Core']]), NAMESPACE).size).toBe(0);
  });
});

describe('BP/texts emit', () => {
  it('writes the meta keys to the BP and the full set to the RP', () => {
    const work = scaffold(WITH_META);
    const log = run(work);

    expect(parseLang(read(work, 'BP/texts/en_US.lang'))).toEqual({
      [`${NAMESPACE}.meta.name`]: 'Shop',
      [`${NAMESPACE}.meta.description`]: 'Sells items',
      [`${NAMESPACE}.meta.creator`]: 'DrAv0011',
      // Bedrock only resolves a manifest header from these two literal keys.
      'pack.name': 'Shop',
      'pack.description': 'Sells items',
    });
    // Non-meta keys stay out of the BP, and the RP still carries everything —
    // plus the same aliases, since the RP has a manifest of its own.
    expect(read(work, 'BP/texts/en_US.lang')).not.toContain('shop.title');
    expect(Object.keys(parseLang(read(work, 'RP/texts/en_US.lang'))).sort()).toEqual([
      `${NAMESPACE}.meta.creator`,
      `${NAMESPACE}.meta.description`,
      `${NAMESPACE}.meta.name`,
      `${NAMESPACE}.shop.bought`,
      `${NAMESPACE}.shop.title`,
      'pack.description',
      'pack.name',
    ]);
    expect(log).toContain('✅ BP/texts/en_US.lang — 5 generated keys');
  });

  it('preserves hand-written BP entries outside the markers', () => {
    const work = scaffold(WITH_META, { 'BP/texts/en_US.lang': 'my.hand.written=Kept\n' });
    run(work);

    const content = read(work, 'BP/texts/en_US.lang');
    expect(stripGeneratedSection(content).trim()).toBe('my.hand.written=Kept');
    expect(parseLang(content)['my.hand.written']).toBe('Kept');
    expect(parseLang(content)[`${NAMESPACE}.meta.name`]).toBe('Shop');
  });

  it('is idempotent, and never re-ingests its own BP keys as passthrough', () => {
    const work = scaffold(WITH_META, { 'BP/texts/en_US.lang': 'my.hand.written=Kept\n' });
    run(work);
    const first = read(work, 'BP/texts/en_US.lang');
    run(work);

    expect(read(work, 'BP/texts/en_US.lang')).toBe(first);

    // The `extra` passthrough strips generated sections before reading, so the
    // meta keys ride the tables only — never both.
    const bundle = JSON.parse(read(work, 'data/i18n/i18n.generated.json'));
    expect(bundle.extra.en_US).toEqual({ 'my.hand.written': 'Kept' });
  });

  it('does every locale the addon has', () => {
    const work = scaffold(WITH_META, {
      'data/i18n/es_ES.ts': "export default {\n  meta: { name: 'Tienda', description: 'Vende objetos', creator: 'DrAv0011' },\n  shop: { title: 'Tienda', bought: 'Compraste {{item}}' },\n} as const;\n",
    });
    run(work);

    expect(parseLang(read(work, 'BP/texts/es_ES.lang'))[`${NAMESPACE}.meta.name`]).toBe('Tienda');
    expect(parseLang(read(work, 'BP/texts/es_ES.lang'))['pack.name']).toBe('Tienda');
    expect(parseLang(read(work, 'RP/texts/es_ES.lang'))['pack.description']).toBe('Vende objetos');
    expect(JSON.parse(read(work, 'BP/texts/languages.json'))).toEqual(['en_US', 'es_ES']);
  });

  it('writes nothing to the BP when the addon declares no meta branch', () => {
    const work = scaffold("{ shop: { title: 'Shop' } }");
    const log = run(work);

    expect(exists(work, 'BP/texts/en_US.lang')).toBe(false);
    expect(exists(work, 'BP/texts/languages.json')).toBe(false);
    expect(log).not.toContain('BP/texts/en_US.lang');
    // …and the RP path is untouched by the BP decision.
    expect(parseLang(read(work, 'RP/texts/en_US.lang'))).toEqual({ [`${NAMESPACE}.shop.title`]: 'Shop' });
  });

  it('drops a stale generated section when the meta branch goes away', () => {
    const work = scaffold(WITH_META, { 'BP/texts/en_US.lang': 'my.hand.written=Kept\n' });
    run(work);
    expect(read(work, 'BP/texts/en_US.lang')).toContain(`${NAMESPACE}.meta.name`);

    fs.writeFileSync(path.join(work, 'data', 'i18n', 'en_US.ts'), "export default { shop: { title: 'Shop' } } as const;\n", 'utf-8');
    run(work);

    expect(read(work, 'BP/texts/en_US.lang').trim()).toBe('my.hand.written=Kept');
  });
});
