# guides

A Regolith filter that compiles MDX guide content under `data/guides/<locale>/**` into a guide IR
manifest and auto-localized `.lang` entries, rendered in-game by
[`@bedrock-core/guides`](https://github.com/bedrock-core/apps). Every heading, paragraph, list
item, link label and admonition title becomes a localization key, so the client resolves guide
text per player language for free. By default it also writes one generated `*.screen.tsx` per
page for the [`ui-compiler`](../ui-compiler/README.md) filter to bake. In the
[`core`](../core/README.md) stack it runs between `generator` and `i18n`, since its localization
keys must land before `i18n` collects them.

## Install

```bash
regolith install github.com/bedrock-core/regolith-filters/guides
```

```tsx
import type { Player } from '@minecraft/server';
import { openGuide } from '@bedrock-core/guides';

export function showGuide(player: Player): void {
  openGuide('my_addon', player);
}
```

## Documentation

https://bedrock-core.drav.dev/docs/filters/guides
