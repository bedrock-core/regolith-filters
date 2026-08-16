import { describe, expect, it } from 'vitest';

import { bundleDtsText } from '../lib/dts.js';
import { parseLang, stripGeneratedSection, upsertGeneratedSection } from '../lib/lang.js';
import { vanillaDtsText } from '../lib/vanilla.js';

describe('lang sections', () => {
  it('round-trips: upsert is idempotent and preserves hand-written entries', () => {
    const hand = 'my.key=Hand written\n';
    const once = upsertGeneratedSection(hand, new Map([['ns.a', 'A'], ['ns.b', 'B']]));
    const twice = upsertGeneratedSection(once, new Map([['ns.a', 'A'], ['ns.b', 'B']]));
    expect(twice).toBe(once);
    expect(parseLang(twice)).toEqual({ 'my.key': 'Hand written', 'ns.a': 'A', 'ns.b': 'B' });
  });

  it('strips the old section before writing the new one', () => {
    const v1 = upsertGeneratedSection('', new Map([['ns.old', 'gone']]));
    const v2 = upsertGeneratedSection(v1, new Map([['ns.new', 'here']]));
    expect(parseLang(v2)).toEqual({ 'ns.new': 'here' });
    expect(stripGeneratedSection(v2).trim()).toBe('');
  });
});

describe('vanillaDtsText', () => {
  it('builds a nested readonly tree with string leaves', () => {
    const dts = vanillaDtsText(['item.apple.name', 'item.bread.name']);
    expect(dts).toContain("declare module '@bedrock-core/generated/i18n-vanilla'");
    expect(dts).toContain("readonly 'apple'");
    expect(dts).toContain("readonly 'name': string;");
  });

  it('handles a key that is both a leaf and a branch', () => {
    const dts = vanillaDtsText(['item.apple', 'item.apple.name']);
    expect(dts).toMatch(/readonly 'apple': \{[\s\S]*?\} & string;/);
  });
});

describe('bundleDtsText', () => {
  it('roots at the default locale and grafts lib + vanilla branches', () => {
    const dts = bundleDtsText({
      defaultLocale: 'en_US',
      vanilla: true,
      libs: [{ namespace: 'core', typeRefs: ['@bedrock-core/config/i18n/en_US'] }],
    });
    expect(dts).toContain("type Own = typeof import('./en_US').default;");
    expect(dts).toContain("type Lib_core = typeof import('@bedrock-core/config/i18n/en_US').default;");
    expect(dts).toContain('readonly core: Lib_core;');
    expect(dts).toContain("import('@bedrock-core/generated/i18n-vanilla').VanillaResources");
    expect(dts).toContain("readonly libs: readonly ['core'];");
  });

  it('omits branches when there are none', () => {
    const dts = bundleDtsText({ defaultLocale: 'en_US', vanilla: false, libs: [] });
    expect(dts).toContain('readonly resources?: Own;');
    expect(dts).not.toContain('i18n-vanilla');
  });
});
