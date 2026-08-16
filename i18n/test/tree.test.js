import { describe, expect, it } from 'vitest';

import { checkParity, checkPlurals, checkVarParity, flattenResources } from '../lib/tree.js';

const collect = () => {
  const errors = [];
  return { errors, report: { error: (scope, msg) => errors.push(`${scope}: ${msg}`) } };
};

describe('flattenResources', () => {
  it('flattens nested objects to dot paths', () => {
    const { errors, report } = collect();
    const map = flattenResources({ shop: { title: 'Shop', nested: { deep: 'x' } } }, report);
    expect([...map]).toEqual([['shop.title', 'Shop'], ['shop.nested.deep', 'x']]);
    expect(errors).toEqual([]);
  });

  it('rejects newlines, bad segments, and non-string leaves', () => {
    const { errors, report } = collect();
    const map = flattenResources({ 'bad key': 'x', multi: 'a\nb', num: 5 }, report);
    expect(map.size).toBe(0);
    expect(errors).toHaveLength(3);
  });

  it('rejects nesting past six levels', () => {
    const { errors, report } = collect();
    flattenResources({ a: { b: { c: { d: { e: { f: { g: 'too deep' } } } } } } }, report);
    expect(errors[0]).toMatch(/deeper than 6/);
  });

  it('rejects a non-object root', () => {
    const { errors, report } = collect();
    flattenResources('nope', report);
    expect(errors).toHaveLength(1);
  });
});

describe('checkParity', () => {
  it('reports both directions', () => {
    const def = new Map([['a', '1'], ['b', '2']]);
    const other = new Map([['b', '2'], ['c', '3']]);
    expect(checkParity(def, other)).toEqual({ missing: ['a'], extra: ['c'] });
  });

  it('accepts locale-only plural variants whose group the default declares', () => {
    const def = new Map([['stock_one', 'x'], ['stock_other', 'y']]);
    const other = new Map([['stock_one', 'x'], ['stock_few', 'f'], ['stock_other', 'y'], ['orphan_few', 'z']]);
    expect(checkParity(def, other)).toEqual({ missing: [], extra: ['orphan_few'] });
  });
});

describe('checkVarParity', () => {
  it('flags drifted variable sets, ignoring order', () => {
    const def = new Map([['k', '{{a}} {{b}}'], ['ok', '{{x}} {{y}}']]);
    const other = new Map([['k', '{{a}} {{c}}'], ['ok', '{{y}} and {{x}}']]);
    const drifted = checkVarParity(def, other);
    expect(drifted).toHaveLength(1);
    expect(drifted[0].path).toBe('k');
  });

  it('checks locale-only plural variants against the group _other reference', () => {
    const def = new Map([['stock_other', '{{count}} left']]);
    const other = new Map([['stock_few', '{{count}} few'], ['stock_many', '{{n}} many']]);
    const drifted = checkVarParity(def, other);
    expect(drifted).toHaveLength(1);
    expect(drifted[0].path).toBe('stock_many');
  });
});

describe('checkPlurals', () => {
  it('requires _other for every plural group', () => {
    const map = new Map([['stock_one', 'x'], ['stock_other', 'y'], ['lonely_one', 'z']]);
    expect(checkPlurals(map)).toEqual(['lonely']);
  });
});
