import { describe, expect, it } from 'vitest';

import { guideScreenModules, guideScreenNames, guideScreenTables } from '../lib/screens.ts';

const input = {
  pageIds: ['intro', 'getting-started/installation'],
  screensDir: 'BP/scripts/guides',
  manifestPath: 'data/guides/guides.generated.json',
  title: 'Guide',
};

const everyone = guideScreenNames('player');
const operators = guideScreenNames('op');

describe('guideScreenModules', () => {
  it('folds a page id to a screen name the JSON UI namespace accepts', () => {
    expect(everyone.page('getting-started/first-screen')).toBe('guide_getting_started_first_screen');
    expect(everyone.page('Intro')).toBe('guide_intro');
  });

  it('emits the entry, one module per page with pages sorted, then the back entry and the index', () => {
    const files = guideScreenModules(input).map(module => module.file);

    expect(files).toEqual([
      'BP/scripts/guides/guide_home.screen.tsx',
      'BP/scripts/guides/guide_getting_started_installation.screen.tsx',
      'BP/scripts/guides/guide_intro.screen.tsx',
      'BP/scripts/guides/guide_home_back.screen.tsx',
      'BP/scripts/guides/guide_index.screen.tsx',
    ]);
  });

  it('imports the manifest relatively from the screens directory', () => {
    const [home, page] = guideScreenModules(input);

    expect(home.source).toContain('import manifest from "../../../data/guides/guides.generated.json";');
    expect(home.source).toContain('export default guideHomeScreen(manifest, { title: "Guide" });');
    expect(page.source).toContain('export default guidePageScreen(manifest, "getting-started/installation", { title: "Guide" });');
  });

  it('imports the component registry when one is named, pages only', () => {
    const [home, page] = guideScreenModules({ ...input, components: 'BP/scripts/UI/guideComponents.ts' });

    expect(home.source).not.toContain('components');
    expect(page.source).toContain('import components from "../UI/guideComponents";');
    expect(page.source).toContain('{ title: "Guide", components }');
  });

  it('refuses two pages that fold to one screen', () => {
    expect(() => guideScreenModules({ ...input, pageIds: ['a-b', 'a_b'] })).toThrow(/"a-b" and "a_b"/);
    expect(() => guideScreenModules({ ...input, pageIds: ['home'] })).toThrow(/the guide entry/);
    expect(() => guideScreenModules({ ...input, pageIds: ['index'] })).toThrow(/the guide index/);
  });
});

describe('a gated guide', () => {
  const gated = { ...input, pageIds: ['intro', 'admin/reset'], gated: true, gatedPageIds: ['admin/reset'] };

  it('names the operators\' set apart from anything a page id can fold to', () => {
    expect([operators.home, operators.homeBack, operators.index]).toEqual(['guideop_home', 'guideop_home_back', 'guideop_index']);
    expect(operators.page('admin/reset')).toBe('guideop_admin_reset');
    // A folder called `op` stays in the ordinary set, clear of the operators' names.
    expect(everyone.page('op/home')).toBe('guide_op_home');
  });

  it('compiles the set every player reads without the gated pages, then the whole guide again for operators', () => {
    expect(guideScreenModules(gated).map(module => module.file)).toEqual([
      'BP/scripts/guides/guide_home.screen.tsx',
      'BP/scripts/guides/guide_intro.screen.tsx',
      'BP/scripts/guides/guide_home_back.screen.tsx',
      'BP/scripts/guides/guide_index.screen.tsx',
      'BP/scripts/guides/guideop_home.screen.tsx',
      'BP/scripts/guides/guideop_admin_reset.screen.tsx',
      'BP/scripts/guides/guideop_intro.screen.tsx',
      'BP/scripts/guides/guideop_home_back.screen.tsx',
      'BP/scripts/guides/guideop_index.screen.tsx',
    ]);
  });

  it('builds the ordinary set with no audience and the operators\' set for operators', () => {
    const sources = new Map(guideScreenModules({ ...gated, components: 'BP/scripts/UI/guideComponents.ts' }).map(module => [module.file.slice(module.file.lastIndexOf('/') + 1), module.source]));

    expect(sources.get('guide_home.screen.tsx')).toContain('guideHomeScreen(manifest, { title: "Guide" });');
    expect(sources.get('guide_intro.screen.tsx')).toContain('guidePageScreen(manifest, "intro", { title: "Guide", components });');
    expect(sources.get('guideop_home.screen.tsx')).toContain('guideHomeScreen(manifest, { title: "Guide", audience: "op" });');
    expect(sources.get('guideop_home_back.screen.tsx')).toContain('guideHomeScreen(manifest, { title: "Guide", audience: "op", back: true });');
    expect(sources.get('guideop_index.screen.tsx')).toContain('guideIndexScreen(manifest, { title: "Guide", audience: "op" });');
    expect(sources.get('guideop_admin_reset.screen.tsx')).toContain('guidePageScreen(manifest, "admin/reset", { title: "Guide", audience: "op", components });');
  });

  it('compiles only the ordinary set when nothing is gated, whatever the page list', () => {
    expect(guideScreenModules({ ...gated, gated: false }).map(module => module.file)).toEqual(
      guideScreenModules({ ...input, pageIds: ['intro', 'admin/reset'] }).map(module => module.file),
    );
  });

  it('refuses a page that folds onto an operators\' entry', () => {
    expect(() => guideScreenModules({ ...gated, pageIds: ['intro', 'index'], gatedPageIds: ['index'] })).toThrow(/the operators' guide index/);
  });

  it('writes each set\'s page screens for the manifest', () => {
    expect(guideScreenTables(gated)).toEqual({
      screens: { intro: 'guide_intro' },
      opScreens: { 'admin/reset': 'guideop_admin_reset', 'intro': 'guideop_intro' },
    });
    expect(guideScreenTables(input)).toEqual({
      screens: { 'getting-started/installation': 'guide_getting_started_installation', 'intro': 'guide_intro' },
    });
  });
});
