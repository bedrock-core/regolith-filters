// The interpolation contract with @bedrock-core/i18n. This filter converts
// {{var}} templates to positional %N$s when writing .lang files; the runtime
// package performs the identical conversion in toTranslationTables() when
// publishing to replicated state. Both test suites pin the SAME table —
// ui/packages/i18n/src/__tests__/contract.test.ts carries the counterpart —
// so a drift on either side fails a build instead of landing arguments in
// wrong placeholders.

import { describe, expect, it } from 'vitest';

import { templateVars, toPositional } from '../lib/interp.js';

const INTERPOLATION_CONTRACT = [
  { template: 'You bought {{item}} for {{price}} emeralds.', order: ['item', 'price'], positional: 'You bought %1$s for %2$s emeralds.' },
  { template: 'Por {{price}} esmeraldas compraste {{item}}.', order: ['item', 'price'], positional: 'Por %2$s esmeraldas compraste %1$s.' },
  { template: '{{ count }} left in stock', order: ['count'], positional: '%1$s left in stock' },
  { template: 'Version: {{version}}', order: ['version'], positional: 'Version: %1$s' },
  { template: 'No variables here.', order: [], positional: 'No variables here.' },
  { template: '{{a}}{{b}}{{a}}', order: ['a', 'b'], positional: '%1$s%2$s%1$s' },
];

describe('interpolation contract', () => {
  for (const { template, order, positional } of INTERPOLATION_CONTRACT) {
    it(`"${template}" → "${positional}"`, () => {
      expect(toPositional(template, order)).toBe(positional);
    });
  }

  it('records argument order as first appearance in the default template', () => {
    // The recorded order is what the runtime's raw() builds `with` from — the
    // first two rows share one order because es_ES translates the first.
    expect(templateVars(INTERPOLATION_CONTRACT[0].template)).toEqual(['item', 'price']);
    expect(templateVars('{{ count }} left in stock')).toEqual(['count']);
  });
});
