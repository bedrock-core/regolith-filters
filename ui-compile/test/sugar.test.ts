import { describe, expect, it } from 'vitest';

import { desugarJsxConditionals } from '../lib/sugar.ts';

describe('desugarJsxConditionals', () => {
  it('turns a && guard into carried visible', () => {
    const out = desugarJsxConditionals('const a = <P>{cond && <X w={1}/>}</P>;');

    expect(out).toBe('const a = <P><X visible={cond} liveVisible={true} w={1}/></P>;');
  });

  it('keeps the guard expression whole', () => {
    const out = desugarJsxConditionals('const a = <P>{n > 0 && open && <X/>}</P>;');

    expect(out).toBe('const a = <P><X visible={n > 0 && open} liveVisible={true}/></P>;');
  });

  it('merges into an existing visible', () => {
    const out = desugarJsxConditionals('const a = <P>{cond && <X visible={shown}/>}</P>;');

    expect(out).toBe('const a = <P><X visible={(shown) && (cond)} liveVisible={true}/></P>;');
  });

  it('turns a ternary into both branches with opposite visibility', () => {
    const out = desugarJsxConditionals('const a = <P>{cond ? <X/> : <Y/>}</P>;');

    expect(out).toBe('const a = <P><X visible={cond} liveVisible={true}/><Y visible={!(cond)} liveVisible={true}/></P>;');
  });

  it('drops a nullish ternary branch', () => {
    expect(desugarJsxConditionals('const a = <P>{cond ? <X/> : null}</P>;'))
      .toBe('const a = <P><X visible={cond} liveVisible={true}/></P>;');
    expect(desugarJsxConditionals('const a = <P>{cond ? undefined : <Y/>}</P>;'))
      .toBe('const a = <P><Y visible={!(cond)} liveVisible={true}/></P>;');
  });

  it('rewrites nested conditionals inside a rewritten branch', () => {
    const out = desugarJsxConditionals('const a = <P>{outer && <X>{inner && <Y/>}</X>}</P>;');

    expect(out).toBe('const a = <P><X visible={outer} liveVisible={true}><Y visible={inner} liveVisible={true}/></X></P>;');
  });

  it('reaches conditionals inside untouched expression children', () => {
    const out = desugarJsxConditionals('const a = <P>{items.map(i => <X k={i}>{c && <Y/>}</X>)}</P>;');

    expect(out).toBe('const a = <P>{items.map(i => <X k={i}><Y visible={c} liveVisible={true}/></X>)}</P>;');
  });

  it('unwraps parentheses around the element', () => {
    const out = desugarJsxConditionals('const a = <P>{cond && (<X/>)}</P>;');

    expect(out).toBe('const a = <P><X visible={cond} liveVisible={true}/></P>;');
  });

  it('leaves non-element branches alone', () => {
    const untouched = [
      'const a = <P>{cond && "text"}</P>;',
      'const a = <P>{cond && render()}</P>;',
      'const a = <P>{cond ? <X/> : "text"}</P>;',
      'const a = <P>{cond ? <></> : <Y/>}</P>;',
      'const a = <P>{value}</P>;',
      'const a = cond && something;',
    ];

    for (const source of untouched) {
      expect(desugarJsxConditionals(source)).toBe(source);
    }
  });

  it('rewrites element children of a fragment container', () => {
    const out = desugarJsxConditionals('const a = <>{cond && <X/>}</>;');

    expect(out).toBe('const a = <><X visible={cond} liveVisible={true}/></>;');
  });

  it('keeps surrounding formatting', () => {
    const source = 'const a = (\n  <P>\n    <A/>\n    {cond && <X/>}\n    <B/>\n  </P>\n);\n';

    expect(desugarJsxConditionals(source))
      .toBe('const a = (\n  <P>\n    <A/>\n    <X visible={cond} liveVisible={true}/>\n    <B/>\n  </P>\n);\n');
  });
});
