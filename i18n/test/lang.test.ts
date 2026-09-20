import { describe, expect, it } from 'vitest';

import { parseLang, upsertGeneratedSection } from '../lib/lang.ts';

describe('parseLang', () => {
  it('keeps a value verbatim, trailing spaces included', () => {
    const map = parseLang('a.run=Back to \nb.run= or the \nc.eq=x=y\n');

    expect(map).toEqual({ 'a.run': 'Back to ', 'b.run': ' or the ', 'c.eq': 'x=y' });
  });

  it('drops only the line ending, comments and blanks', () => {
    const map = parseLang('## comment\r\n\r\n  \r\nk=v \r\n  # indented comment\nno-equals\n');

    expect(map).toEqual({ k: 'v ' });
  });
});

describe('upsertGeneratedSection', () => {
  it('keeps a trailing space on the last hand-written value', () => {
    const out = upsertGeneratedSection('a.run=Back to \n\n  \n', new Map([['b', 'c']]));

    expect(parseLang(out)['a.run']).toBe('Back to ');
  });
});
