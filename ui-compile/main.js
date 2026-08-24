// @bedrock-core/regolith-filters — ui-compile
//
// Container screens are written as JSX under RP/ui and compiled here into static
// JSON UI. Unlike a server form, a container screen cannot be serialized at
// runtime: the chest screen offers no string channel wide enough to carry a
// layout, so the layout is baked and only state travels at runtime.
//
// For each `RP/ui/**/*.screen.tsx` this filter:
//   1. bundles the screen together with the compiler, using the PROJECT'S copy
//      of @bedrock-core/ui-runtime and @bedrock-core/ui-compile, so a screen is
//      always compiled against the library the addon actually ships,
//   2. expands components, solves flexbox, allocates slot indices, emits JSON UI,
//   3. writes RP/ui/compiled/<name>.json,
//   4. writes data/ui/<name>.ts — the typed handle the script uses to address
//      slots by name instead of restating indices,
//   5. sizes `minecraft:inventory` on the entity the screen names,
//   6. removes the source from the pack, because .tsx is not a pack asset.
//
// One router covers every screen: a cheap protocol check decides whether a chest
// is ours at all, and a layout key decides which. A vanilla chest fails the
// first check and renders untouched.

import fs from 'node:fs';
import path from 'node:path';

import { buildHandle } from './lib/handle.js';
import { compileScreen } from './lib/load.js';
import { buildRouter } from './lib/router.js';
import { registerUiDefs } from './lib/uiDefs.js';

const projectRoot = process.env['ROOT_DIR'];

if (!projectRoot) {
  console.error('❌ ROOT_DIR environment variable not set');
  console.error('This filter must be run by Regolith');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

const defaults = {
  namespace: 'bcui',
  sourceDir: 'RP/ui',
  outputDir: 'RP/ui/compiled',
  // Must be vanilla's own path. JSON UI resolves a definition from the file that
  // owns it, so `chest.small_chest_panel_top_half` declared in any other file —
  // same namespace or not — is simply ignored, and the vanilla chest renders.
  routerFile: 'RP/ui/chest_screen.json',
  handleDir: 'data/ui',
  entityDir: 'BP/entities',
  textsDir: 'RP/texts',
  // Where the generated character table lives. Must match the compiler's.
  keyPrefix: 'bcui.c.',
  collection: 'container_items',
  jsxImportSource: '@bedrock-core/ui',
  // Netherite pickaxe: damageable, so its durability can carry the layout key,
  // and 2031 layouts fit before a second marker item is needed.
  protocolItemAux: 40763392,
  // Durability reading that marks a button's transport item, so the redrawn
  // inventory and hotbar grids draw it as nothing while the script pulls it
  // back. Must match the runtime's `TRANSPORT_ORDINAL`.
  transportOrdinal: 2001,
};

const settings = { ...defaults, ...JSON.parse(process.argv[2] ?? '{}') };

const cacheDir = path.join(projectRoot, '.regolith', 'cache', 'ui-compile');

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

/** Screens are marked by extension, so ordinary .tsx helpers can sit beside them. */
const SCREEN_SUFFIX = '.screen.tsx';

/** @param {string} dir @returns {string[]} */
function findScreens(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }

  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      return findScreens(full);
    }

    return entry.name.endsWith(SCREEN_SUFFIX) ? [full] : [];
  });
}

// Sorted so layout keys are stable across builds: an unstable key would leave
// every already-placed entity in a world pointing at the wrong screen.
const screenPaths = findScreens(path.resolve(settings.sourceDir)).sort();

if (screenPaths.length === 0) {
  console.log(`ℹ️  ui-compile: no *${SCREEN_SUFFIX} under ${settings.sourceDir}, nothing to do`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Compile
// ---------------------------------------------------------------------------

/**
 * Reads a pack JSON file that may carry comments.
 *
 * Vanilla tolerates JSONC in pack files and authors use it, so `JSON.parse`
 * alone is not enough to READ one. Comments do not survive the round trip, but
 * only the workspace copy is ever written back -- the author's own file is left
 * exactly as they wrote it.
 */
const readJsonc = (file) => {
  const raw = fs.readFileSync(file, 'utf-8');
  let out = '';
  let inString = false;
  let escaped = false;

  for (let at = 0; at < raw.length; at += 1) {
    const char = raw[at];
    const next = raw[at + 1];

    if (inString) {
      out += char;

      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }

      continue;
    }

    if (char === '"') {
      inString = true;
      out += char;

      continue;
    }

    if (char === '/' && next === '/') {
      while (at < raw.length && raw[at] !== '\n') {
        at += 1;
      }

      out += '\n';

      continue;
    }

    if (char === '/' && next === '*') {
      at += 2;

      while (at < raw.length && !(raw[at] === '*' && raw[at + 1] === '/')) {
        at += 1;
      }

      at += 1;

      continue;
    }

    out += char;
  }

  return JSON.parse(out);
};

const rel = file => path.relative(projectRoot, file).replaceAll('\\', '/');

/** Collects the IR nodes of one kind, in document order. */
const collect = (node, kind, into = []) => {
  if (node.kind === kind) {
    into.push(node);
  }

  for (const child of node.children ?? []) {
    collect(child, kind, into);
  }

  return into;
};

/**
 * Every node holding a bank slot, in document order.
 *
 * A text run is one channel by name but many slots underneath — one per
 * character — so its width travels with it.
 */
const collectChannels = (node, into = []) => {
  if (typeof node.channel === 'number') {
    into.push({
      slot: node.channel,
      carrier: node.kind === 'text' ? 'text' : 'ratio',
      length: node.kind === 'text' ? node.length : 1,
    });
  }

  for (const child of node.children ?? []) {
    collectChannels(child, into);
  }

  return into;
};

const outputDir = path.resolve(settings.outputDir);
const handleDir = path.resolve(settings.handleDir);

fs.mkdirSync(outputDir, { recursive: true });
fs.mkdirSync(handleDir, { recursive: true });

const compiled = [];

for (const [index, screenPath] of screenPaths.entries()) {
  const name = path.basename(screenPath, SCREEN_SUFFIX);
  const namespace = `${settings.namespace}_${name}`;
  const layoutId = index + 1;

  let result;

  try {
    result = await compileScreen({
      screenPath,
      namespace,
      collection: settings.collection,
      cacheDir,
      jsxImportSource: settings.jsxImportSource,
      keyPrefix: settings.keyPrefix,
    });
  } catch (error) {
    // The compiler's own errors already say what to do — a rejected hook names
    // its replacement, an unsupported control lists what is supported. Relaying
    // the message unchanged beats wrapping it.
    console.error(`❌ ui-compile: ${rel(screenPath)}`);
    console.error(String(error instanceof Error ? error.message : error));
    process.exit(1);
  }

  const header = [
    '// GENERATED by the ui-compile filter — do not edit.',
    `// Source: ${rel(screenPath)}`,
    '',
  ].join('\n');

  fs.writeFileSync(
    path.join(outputDir, `${name}.json`),
    `${header}${JSON.stringify(result.document, null, '\t')}\n`,
    'utf-8',
  );

  const screen = {
    name,
    namespace,
    layoutId,
    entry: result.ir.entry,
    allocation: result.ir.allocation,
    entity: result.entity,
    lang: result.lang,
    slots: collect(result.ir.root, 'slot').map(node => ({ slot: node.slot, role: node.role })),
    source: `./${name}.screen`,
    // Collected by what they carry, not by what they are.
    channels: collectChannels(result.ir.root),
  };

  // The component itself has to reach the behaviour pack: the runtime
  // re-renders it per player to produce the live values, and RP/ui is not
  // bundled into scripts. Copying rather than importing across packs keeps the
  // handle and the component in the same place, so one import gets both.
  const screenSource = fs.readFileSync(screenPath, 'utf-8');
  const componentFile = `${name}.screen.tsx`;

  fs.writeFileSync(path.join(handleDir, componentFile), screenSource, 'utf-8');

  const source = buildHandle(screen);

  fs.writeFileSync(path.join(handleDir, `${name}.ts`), source, 'utf-8');

  // Also committed to the project — but under packs/data, never into RP or BP.
  // A filter takes the user's source and produces a build; it does not edit the
  // pack folders. data/ is the agreed place for generated modules, the bundler
  // resolves a tsconfig alias into it, and committing it is what lets the editor
  // and `tsc` see the handle without a build having run. Changed-only, so the
  // file watcher stays quiet — the same shape the i18n filter uses.
  for (const [file, contents] of [[`${name}.ts`, source], [componentFile, screenSource]]) {
    const committed = path.join(projectRoot, 'packs', settings.handleDir, file);

    if (!fs.existsSync(committed) || fs.readFileSync(committed, 'utf-8') !== contents) {
      fs.mkdirSync(path.dirname(committed), { recursive: true });
      fs.writeFileSync(committed, contents, 'utf-8');
    }
  }

  compiled.push(screen);

  const { drawn, channels, size } = screen.allocation;

  console.log(
    `✅ ui-compile: ${name} — ${drawn} slot(s), ${channels} channel(s), inventory_size ${size}`,
  );
}

// ---------------------------------------------------------------------------
// Character table
// ---------------------------------------------------------------------------

// A container slot publishes no text, so a string reaches a screen one
// character at a time: each cell reads its slot's stack size and localizes
// `bcui.c.<code>`. This is the table that turns those codes back into glyphs.
//
// It is generated rather than written because it is the contract between the
// compiler and the runtime — they encode against the same list or nothing
// renders — and it lands in the WORKSPACE, never in the user's own texts/.
if (compiled.some(screen => screen.channels.some(channel => channel.carrier === 'text'))) {
  const textsDir = path.resolve(settings.textsDir);
  const lines = compiled.find(screen => screen.lang)?.lang ?? [];

  fs.mkdirSync(textsDir, { recursive: true });

  for (const file of fs.existsSync(textsDir)
    ? fs.readdirSync(textsDir).filter(name => name.endsWith('.lang'))
    : []) {
    const target = path.join(textsDir, file);
    const existing = fs.readFileSync(target, 'utf-8');

    // Guarded on the first line the table actually produces, not on a code
    // that may not have one: the blank has no entry, so keying the check on it
    // would append the whole table again on every build.
    if (lines[0] !== undefined && existing.includes(lines[0])) {
      continue;
    }

    fs.writeFileSync(
      target,
      [
        existing.replace(/\s*$/, ''),
        '',
        '## Generated by the ui-compile filter -- the character table a text',
        '## channel is decoded through. One slot carries one code; the label',
        '## localizes this key and the value below is what gets drawn.',
        ...lines,
        '',
      ].join('\n'),
      'utf-8',
    );
  }

  console.log(`   ↳ character table → ${lines.length} entries per language`);
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const routerFile = path.resolve(settings.routerFile);

fs.mkdirSync(path.dirname(routerFile), { recursive: true });

fs.writeFileSync(
  routerFile,
  '// GENERATED by the ui-compile filter — do not edit.\n'
  + '// Gates every compiled layout onto the vanilla chest screen.\n'
  + '//\n'
  + '// This has to be vanilla\'s own file. JSON UI resolves a definition from the\n'
  + '// file that owns it, so replacing `chest.small_chest_panel_top_half` from any\n'
  + '// other path — same namespace or not — is silently ignored, and the ordinary\n'
  + '// chest renders instead.\n'
  + `${JSON.stringify(
    buildRouter({
      screens: compiled,
      collection: settings.collection,
      protocolAux: settings.protocolItemAux,
      transportOrdinal: settings.transportOrdinal,
    }),
    null,
    '\t',
  )}\n`,
  'utf-8',
);

console.log(`   ↳ router → ${rel(routerFile)}`);

// ---------------------------------------------------------------------------
// Handle barrel
// ---------------------------------------------------------------------------

// One module re-exporting every screen's handle, so the project needs a single
// tsconfig alias no matter how many screens it has.
//
// It has to be a barrel rather than a glob alias: the bundler's path plugin
// strips the `*` out of a tsconfig candidate before joining the import suffix,
// so `./packs/data/ui/*` resolves to an extensionless path esbuild cannot read.
// A non-glob alias pointing at one real file sidesteps that entirely — the same
// shape the i18n and guides aliases already use.
const barrel = [
  '// GENERATED by the ui-compile filter — do not edit.',
  '//',
  '// Every compiled screen, re-exported under its own name. Import the handle',
  '// and hand it to `createContainerScreen`; it carries the slot indices, the',
  '// bank layout and the routing key the compiler chose.',
  '',
  ...compiled.map(screen => `export * as ${screen.name} from './${screen.name}';`),
  '',
].join('\n');

fs.writeFileSync(path.join(handleDir, 'index.ts'), barrel, 'utf-8');

const committedBarrel = path.join(projectRoot, 'packs', settings.handleDir, 'index.ts');

if (!fs.existsSync(committedBarrel) || fs.readFileSync(committedBarrel, 'utf-8') !== barrel) {
  fs.mkdirSync(path.dirname(committedBarrel), { recursive: true });
  fs.writeFileSync(committedBarrel, barrel, 'utf-8');
}

// ---------------------------------------------------------------------------
// _ui_defs.json
// ---------------------------------------------------------------------------

const added = registerUiDefs({
  uiDefsFile: path.join(path.resolve(settings.sourceDir), '_ui_defs.json'),
  files: [routerFile, ...compiled.map(screen => path.join(outputDir, `${screen.name}.json`))],
});

if (added > 0) {
  console.log(`   ↳ registered ${added} file(s) in _ui_defs.json`);
}
// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

// A screen names the entity it opens from; the compiler knows how many slots
// that needs. Sizing it here means nobody has to keep `inventory_size` in step
// with a layout by hand — the failure mode of which is a screen that silently
// draws cells the container does not have.
const entityDir = path.resolve(settings.entityDir);

for (const screen of compiled) {
  if (!screen.entity) {
    continue;
  }

  const files = fs.existsSync(entityDir)
    ? fs.readdirSync(entityDir).filter(file => file.endsWith('.json'))
    : [];

  const match = files
    .map(file => path.join(entityDir, file))
    .find((file) => {
      const parsed = readJsonc(file);

      return parsed['minecraft:entity']?.description?.identifier === screen.entity;
    });

  if (!match) {
    console.error(`❌ ui-compile: ${screen.name} names entity "${screen.entity}", which is not in ${settings.entityDir}`);
    process.exit(1);
  }

  const definition = readJsonc(match);
  const components = definition['minecraft:entity'].components ??= {};
  const inventory = components['minecraft:inventory'] ??= {};

  // `container` is the only container_type that routes to the chest screen, and
  // `private: true` stops the player opening it at all.
  inventory.container_type = 'container';
  inventory.inventory_size = screen.allocation.size;
  inventory.private = false;

  fs.writeFileSync(match, `${JSON.stringify(definition, null, '\t')}\n`, 'utf-8');

  console.log(`   ↳ sized ${screen.entity} to ${screen.allocation.size} slot(s)`);
}

// ---------------------------------------------------------------------------
// Clean up
// ---------------------------------------------------------------------------

// Sources are not pack assets: shipping them exports the whole screen tree, and
// the game logs an error for every unknown file under ui/.
for (const screenPath of screenPaths) {
  fs.rmSync(screenPath);
}
