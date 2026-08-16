import { describe, expect, it } from 'vitest';

import { parseLang, stripGeneratedSection, upsertGeneratedSection, SECTION_BEGIN, SECTION_END } from '../lib/lang.js';
import { reconcileLocale, summarizeKeysByPage } from '../lib/locales.js';
import { readPngSize } from '../lib/png.js';

describe('upsertGeneratedSection', () => {
  const entries = new Map([
    ['demo.guides.intro.title', 'Introduction'],
    ['demo.guides.intro.b0', 'Welcome §lhome§r'],
  ]);

  it('appends a marker-delimited sorted section to existing content', () => {
    const out = upsertGeneratedSection('my.key=Hand written\n', entries);
    expect(out).toBe(
      'my.key=Hand written\n\n' +
        `${SECTION_BEGIN}\n` +
        'demo.guides.intro.b0=Welcome §lhome§r\n' +
        'demo.guides.intro.title=Introduction\n' +
        `${SECTION_END}\n`,
    );
  });

  it('is idempotent — re-running replaces the old section', () => {
    const once = upsertGeneratedSection('my.key=Hand written\n', entries);
    const twice = upsertGeneratedSection(once, new Map([['demo.guides.intro.title', 'Changed']]));
    expect(twice).toContain('my.key=Hand written');
    expect(twice).toContain('demo.guides.intro.title=Changed');
    expect(twice).not.toContain('Welcome');
    expect(twice.match(/<core:generated-guides:begin>/g)).toHaveLength(1);
  });

  it('works on empty files and strips stray newlines in values', () => {
    const out = upsertGeneratedSection('', new Map([['k', 'line1\nline2']]));
    expect(out.startsWith(SECTION_BEGIN)).toBe(true);
    expect(parseLang(out)['k']).toBe('line1 line2');
  });

  it('stripGeneratedSection leaves untouched files alone', () => {
    expect(stripGeneratedSection('a=b\n')).toBe('a=b\n');
  });
});

describe('reconcileLocale', () => {
  const en = new Map([
    ['a.title', 'Title'],
    ['a.b0', 'Body'],
  ]);

  it('fills missing keys from the default locale and drops extras', () => {
    const es = new Map([
      ['a.title', 'Título'],
      ['a.b9', 'huérfano'],
    ]);
    const { filled, missing, extra } = reconcileLocale(en, es);
    expect(filled.get('a.title')).toBe('Título');
    expect(filled.get('a.b0')).toBe('Body');
    expect(filled.has('a.b9')).toBe(false);
    expect(missing).toEqual(['a.b0']);
    expect(extra).toEqual(['a.b9']);
  });

  it('summarizes drift per page', () => {
    const keys = ['ns.guides.intro.b0', 'ns.guides.intro.b1', 'ns.guides.faq.title'];
    expect(summarizeKeysByPage(keys, 'ns.guides')).toEqual(['intro (2 keys)', 'faq (1 key)']);
  });
});

describe('readPngSize', () => {
  it('reads IHDR dimensions', () => {
    const buf = Buffer.alloc(24);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
    buf.write('IHDR', 12, 'ascii');
    buf.writeUInt32BE(320, 16);
    buf.writeUInt32BE(210, 20);
    expect(readPngSize(buf)).toEqual({ w: 320, h: 210 });
  });

  it('rejects non-PNG buffers', () => {
    expect(readPngSize(Buffer.from('not a png at all, sorry'))).toBeUndefined();
  });
});
