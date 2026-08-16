import { describe, expect, it } from 'vitest';

import { scanNamespace, scanVanillaUsage } from '../lib/scan.js';

describe('scanNamespace', () => {
  it('joins the register literals into creator_pack', () => {
    const sources = [{ path: 'main.ts', text: `const config = core.register({\n  creator: 'drav0011',\n  pack: 'economy',\n});` }];
    expect(scanNamespace(sources)).toEqual({ namespace: 'drav0011_economy' });
  });

  it('ignores creator/pack literals in files without a register call', () => {
    const sources = [{ path: 'other.ts', text: `const x = { creator: 'someone', pack: 'else' };` }];
    expect(scanNamespace(sources)).toHaveProperty('reason');
  });

  it('reports ambiguity when two candidates survive', () => {
    const sources = [
      { path: 'a.ts', text: `core.register({ creator: 'a', pack: 'x' })` },
      { path: 'b.ts', text: `core.register({ creator: 'b', pack: 'x' })` },
    ];
    const result = scanNamespace(sources);
    expect(result).toHaveProperty('reason');
    expect(result.reason).toMatch(/ambiguous/);
  });
});

describe('scanVanillaUsage', () => {
  const keys = new Set(['item.apple.name', 'tile.grass.name']);

  it('finds bare string literals', () => {
    const used = scanVanillaUsage([{ path: 'a.ts', text: `measure('item.apple.name')` }], keys);
    expect([...used]).toEqual(['item.apple.name']);
  });

  it('finds vanilla.-prefixed dot strings', () => {
    const used = scanVanillaUsage([{ path: 'a.ts', text: `t('vanilla.tile.grass.name')` }], keys);
    expect([...used]).toEqual(['tile.grass.name']);
  });

  it('finds selector chains', () => {
    const used = scanVanillaUsage([{ path: 'a.ts', text: `t($ => $.vanilla.item.apple.name)` }], keys);
    expect([...used]).toEqual(['item.apple.name']);
  });

  it('does not match runtime-assembled keys', () => {
    const used = scanVanillaUsage([{ path: 'a.ts', text: `const k = 'item.' + id + '.name';` }], keys);
    expect(used.size).toBe(0);
  });
});
