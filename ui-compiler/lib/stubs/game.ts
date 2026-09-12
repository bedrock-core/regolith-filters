// Stands in for the game modules while compiling.
//
// A screen module imports the whole UI library, and the library's runtime entry
// touches the game the moment its graph is evaluated. Nothing compiled may CALL
// any of it — layout and expansion are pure, and a hook that reaches for the
// game is rejected by `expandStatic` with a real message — so the modules only
// have to exist and answer.
//
// The names matter. A namespace object built from a bare proxy looks EMPTY to a
// bundler: the names it copies are the proxy's own keys, and a proxy that
// answers anything has none. So `import { world }` came out undefined, and a
// module that touched it at import time died rather than getting a stub. The
// declarations the package ships are the list, and the package ships nothing
// else — the game modules are types on a build machine.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

import type { Plugin } from 'esbuild';

/** What a game module's `.d.ts` declares, which is every name it exports. */
function gameExports(specifier: string, from: string): string[] {
  try {
    const manifest = createRequire(path.join(from, 'resolve.cjs')).resolve(`${specifier}/package.json`);
    const declarations = fs.readFileSync(path.join(path.dirname(manifest), 'index.d.ts'), 'utf-8');
    const names = new Set<string>();
    const declared = /^export\s+(?:declare\s+)?(?:abstract\s+)?(?:class|const|let|var|function|enum|interface|type)\s+([A-Za-z_$][\w$]*)/gm;

    for (const match of declarations.matchAll(declared)) {
      if (match[1] !== undefined) {
        names.add(match[1]);
      }
    }

    return [...names];
  } catch {
    return [];
  }
}

const ANYTHING = [
  'const handler = {',
  "  get: (target, key) => key === '__esModule' ? true : typeof key === 'symbol' ? undefined : anything(),",
  '  apply: () => anything(),',
  '  construct: () => anything(),',
  '};',
  '',
  '/** Answers to being read, called, constructed and destructured, and means nothing. */',
  'const anything = () => new Proxy(function stub() {}, handler);',
].join('\n');

/** Resolves the game modules to a stub that exports every name they declare. */
export const gameStubPlugin = (from: string): Plugin => ({
  name: 'minecraft-stub',
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /^@minecraft\/server(-ui|-net|-admin)?$/ }, args => ({
      path: args.path,
      namespace: 'minecraft-stub',
    }));

    pluginBuild.onLoad({ filter: /.*/, namespace: 'minecraft-stub' }, args => ({
      contents: [
        ANYTHING,
        '',
        ...gameExports(args.path, from).map(name => `export const ${name} = anything();`),
        '',
        'export default anything();',
        '',
      ].join('\n'),
      loader: 'js',
      resolveDir: from,
    }));
  },
});
