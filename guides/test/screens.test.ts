import { describe, expect, it } from 'vitest';

import { guideScreenModules, guideScreenName, HOME_BACK_SCREEN, HOME_SCREEN } from '../lib/screens.ts';

const input = {
  pageIds: ['intro', 'getting-started/installation'],
  screensDir: 'BP/scripts/guides',
  manifestPath: 'data/guides/guides.generated.json',
  title: 'Guide',
};

describe('guideScreenModules', () => {
  it('folds a page id to a screen name the JSON UI namespace accepts', () => {
    expect(guideScreenName('getting-started/first-screen')).toBe('guide_getting_started_first_screen');
    expect(guideScreenName('Intro')).toBe('guide_intro');
  });

  it('emits the home index plus one module per page, pages sorted', () => {
    const files = guideScreenModules(input).map(module => module.file);

    expect(files).toEqual([
      `BP/scripts/guides/${HOME_SCREEN}.screen.tsx`,
      'BP/scripts/guides/guide_getting_started_installation.screen.tsx',
      'BP/scripts/guides/guide_intro.screen.tsx',
      `BP/scripts/guides/${HOME_BACK_SCREEN}.screen.tsx`,
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
    expect(() => guideScreenModules({ ...input, pageIds: ['home'] })).toThrow(/the home index/);
  });
});
