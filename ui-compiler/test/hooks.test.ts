import { expect, it } from 'vitest';
import { mergeHook, parseJsonc, type Document } from '../lib/hooks.ts';

const createServerFormHook = (addon: string, controls: Record<string, unknown>[]): Document => ({
  namespace: 'server_form',
  third_party_server_screen: { gamepad_cursor: true },
  [`${addon}_compiled_form_bridge`]: {
    type: 'panel', size: ['100%', '100%'], anchor_from: 'top_left', anchor_to: 'top_left', controls,
  },
  main_screen_content: {
    size: ['0px', '0px'],
    modifications: [{ array_name: 'controls', operation: 'insert_back', value: [{ [`${addon}@${addon}_compiled_form_bridge`]: {} }] }],
  },
});

it('keeps form router inheritance outside modification values and preserves two addon bridges', () => {
  const alphaControls = [{ 'alpha@core_ui_form.alpha_forms': { layer: 4 } }];
  const betaControls = [{ 'beta@core_ui_form.beta_forms': {} }];
  const alpha = createServerFormHook('alpha', alphaControls);
  const beta = createServerFormHook('beta', betaControls);
  const merged = mergeHook(JSON.stringify(alpha), beta);

  expect(merged.alpha_compiled_form_bridge).toEqual({
    type: 'panel', size: ['100%', '100%'], anchor_from: 'top_left', anchor_to: 'top_left', controls: alphaControls,
  });
  expect(merged.beta_compiled_form_bridge).toEqual(beta.beta_compiled_form_bridge);
  const main = merged.main_screen_content as { modifications: { value: Record<string, unknown>[] }[] };

  expect(main.modifications.map(modification => modification.value)).toEqual([
    [{ 'alpha@alpha_compiled_form_bridge': {} }],
    [{ 'beta@beta_compiled_form_bridge': {} }],
  ]);
  expect(JSON.stringify(main)).not.toContain('@core_ui_form.');
  expect(merged.default_long_form_panel).toBeUndefined();
  expect(merged.default_custom_form_panel).toBeUndefined();
});

it('preserves existing hook properties and rejects collisions with native or addon-owned definitions', () => {
  const existing = { namespace: 'server_form', main_screen_content: {
    $existing: true, modifications: [{ array_name: 'controls', operation: 'insert_front', value: [{ existing: { type: 'panel' } }] }],
  } };
  const before = structuredClone(existing);
  const hook = createServerFormHook('alpha', [{ 'alpha@core_ui_form.alpha_forms': {} }]);
  const merged = mergeHook(JSON.stringify(existing), hook);

  expect(merged.main_screen_content).toMatchObject({ $existing: true, modifications: [
    existing.main_screen_content.modifications[0], (hook.main_screen_content as { modifications: unknown[] }).modifications[0],
  ] });
  expect(existing).toEqual(before);
  expect(() => mergeHook('{"namespace":"server_form","main_screen_content":{"type":"panel","controls":[]}}', hook))
    .toThrow('a definition there replaces vanilla');
  expect(() => mergeHook(JSON.stringify(hook), hook)).toThrow('an addon-owned hook control cannot replace it');
});

it('reads JSON UI comments without altering comment-like text in string values', () => {
  expect(parseJsonc('/* header */ {"namespace":"server_form", // next\n"path":"https://host/a/*b*/"}'))
    .toEqual({ namespace: 'server_form', path: 'https://host/a/*b*/' });
});

it('preserves compatible vanilla patches in either order and rejects conflicting properties', () => {
  const alpha = createServerFormHook('alpha', [{ 'root@alpha__forms.alpha_forms': {} }]);
  const beta = createServerFormHook('beta', [{ 'root@beta__forms.beta_forms': {} }]);
  for (const [first, second] of [[alpha, beta], [beta, alpha]]) {
    const combined = mergeHook(JSON.stringify(first), second!);
    expect(combined.third_party_server_screen).toEqual({ gamepad_cursor: true });
    expect(combined.main_screen_content).toMatchObject({ size: ['0px', '0px'] });
    expect(combined.alpha_compiled_form_bridge).toEqual(alpha.alpha_compiled_form_bridge);
    expect(combined.beta_compiled_form_bridge).toEqual(beta.beta_compiled_form_bridge);
  }
  expect(() => mergeHook(JSON.stringify({ namespace: 'server_form', main_screen_content: { size: [200, 200] } }), alpha))
    .toThrow('conflicts with the compiler');
  expect(() => mergeHook('{"namespace":"another_screen"}', alpha)).toThrow('different namespace');
});
