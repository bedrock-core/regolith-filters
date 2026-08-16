import { describe, expect, it } from 'vitest';

import { flattenNesting, templateVars, toPositional } from '../lib/interp.js';

describe('templateVars', () => {
  it('returns variables in order of first appearance, deduplicated', () => {
    expect(templateVars('You bought {{item}} for {{price}} ({{item}})')).toEqual(['item', 'price']);
  });

  it('tolerates whitespace inside the braces', () => {
    expect(templateVars('{{ count }} left')).toEqual(['count']);
  });

  it('returns [] for a plain string', () => {
    expect(templateVars('Shop')).toEqual([]);
  });

  it('ignores single braces and malformed markers', () => {
    expect(templateVars('{item} {{1bad}} {{}}')).toEqual([]);
  });
});

describe('toPositional', () => {
  it('rewrites variables to their recorded slot', () => {
    expect(toPositional('You bought {{item}} for {{price}}', ['item', 'price']))
      .toBe('You bought %1$s for %2$s');
  });

  it('lets a translation reorder text while keeping slots stable', () => {
    expect(toPositional('Por {{price}} compraste {{item}}', ['item', 'price']))
      .toBe('Por %2$s compraste %1$s');
  });

  it('throws on a variable outside the recorded order', () => {
    expect(() => toPositional('{{other}}', ['item'])).toThrow(/not in the recorded order/);
  });
});

describe('flattenNesting', () => {
  const table = new Map([
    ['a', 'A'],
    ['b', 'says $t(a)'],
    ['c', '$t(b)!'],
    ['loop1', '$t(loop2)'],
    ['loop2', '$t(loop1)'],
  ]);
  const lookup = (p) => table.get(p);

  it('inlines nested references recursively', () => {
    const errors = [];
    expect(flattenNesting('$t(c)', lookup, (m) => errors.push(m))).toBe('says A!');
    expect(errors).toEqual([]);
  });

  it('reports unknown references', () => {
    const errors = [];
    expect(flattenNesting('$t(nope)', lookup, (m) => errors.push(m))).toBe('');
    expect(errors[0]).toMatch(/unknown key/);
  });

  it('reports cycles instead of recursing forever', () => {
    const errors = [];
    flattenNesting('$t(loop1)', lookup, (m) => errors.push(m));
    expect(errors[0]).toMatch(/circular/);
  });
});
