// @bedrock-core/regolith-filters — ui-compile
//
// Container screens are written as JSX under BP/scripts and compiled here into
// static JSON UI. Unlike a server form, a container screen cannot be serialized
// at runtime: the chest screen offers no string channel wide enough to carry a
// layout, so the layout is baked and only state travels at runtime.
//
// For each `BP/scripts/**/*.screen.tsx` this filter:
//   1. bundles the screen together with the compiler, using the PROJECT'S copy
//      of @bedrock-core/ui-runtime and @bedrock-core/ui-compile, so a screen is
//      always compiled against the library the addon actually ships,
//   2. writes the emitted JSON UI to RP/ui/core-ui/screens/<name>.json,
//   3. stamps the entity the screen names: `minecraft:inventory` sized to the
//      layout, and the entity property the runtime reads the layout key from.
//
// One router covers every screen: a cheap protocol check decides whether a chest
// is ours at all, and a layout key decides which. A vanilla chest fails the
// first check and renders untouched.
//
// Everything is written into the Regolith workspace. A screen is an ordinary
// script module the addon imports itself — the bundler inlines it and strips
// the sources afterwards — so nothing is copied, generated into the project or
// deleted here.

import fs from 'node:fs';
import path from 'node:path';

import { loadScreen } from './lib/load.js';
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

// Fixed addon paths: what Minecraft needs for scripts, entities, UI and texts.
// They are not options — the pack does not work anywhere else — so they are
// constants, not settings. The router in particular MUST be vanilla's own
// path: JSON UI resolves a definition from the file that owns it, so
// `chest.small_chest_panel` declared in any other file is simply ignored, and
// the vanilla chest renders.
const SOURCE_DIR = 'BP/scripts';
const OUTPUT_DIR = 'RP/ui/core-ui/screens';
const ROUTER_FILE = 'RP/ui/chest_screen.json';
const ENTITY_DIR = 'BP/entities';
const TEXTS_DIR = 'RP/texts';
const JSX_IMPORT_SOURCE = '@bedrock-core/ui';

// The one setting: the addon's namespace. Everything else is fixed above.
const settings = JSON.parse(process.argv[2] ?? '{}');

const cacheDir = path.join(projectRoot, '.regolith', 'cache', 'ui-compile');

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

/** Screens are marked by extension, so ordinary .tsx helpers can sit beside them. */
const SCREEN_SUFFIX = '.screen.tsx';

/**
 * Every file under `dir` whose name ends in `suffix`, recursively.
 *
 * @param {string} dir
 * @param {string} suffix
 * @returns {string[]}
 */
function findFiles(dir, suffix) {
  if (!fs.existsSync(dir)) {
    return [];
  }

  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      return findFiles(full, suffix);
    }

    return entry.name.endsWith(suffix) ? [full] : [];
  });
}

// Sorted so layout keys are stable across builds: an entity keeps the key it
// was stamped with, so a key that moved would leave every already-placed entity
// in a world pointing at the wrong screen.
const screenPaths = findFiles(path.resolve(SOURCE_DIR), SCREEN_SUFFIX).sort();

if (screenPaths.length === 0) {
  console.log(`ℹ️  ui-compile: no *${SCREEN_SUFFIX} under ${SOURCE_DIR}, nothing to do`);
  process.exit(0);
}

const rel = file => path.relative(projectRoot, file).replaceAll('\\', '/');

// The name is the JSON UI namespace and the output file, so it has to be unique
// across the addon whatever directory a screen sits in.
const names = screenPaths.map(screenPath => path.basename(screenPath, SCREEN_SUFFIX));
const duplicate = names.find((name, index) => names.indexOf(name) !== index);

if (duplicate !== undefined) {
  console.error(`❌ ui-compile: two screens are named "${duplicate}"; a screen's file name has to be unique`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Namespace
// ---------------------------------------------------------------------------

// The addon's namespace prefixes every screen's JSON UI namespace, so a screen
// is `<namespace>_<name>` — the addon's own name, not the library's. Taken from
// the `namespace` setting, or scanned from the `core.register({ creator, pack })`
// the server package writes, the way the other filters resolve it.
const CREATOR_RE = /\bcreator\s*:\s*(['"`])([a-z0-9_]+)\1/g;
const PACK_RE = /\bpack\s*:\s*(['"`])([a-z0-9_]+)\1/g;

const scanNamespace = (dir) => {
  const creators = new Set();
  const packs = new Set();

  for (const file of [...findFiles(dir, '.ts'), ...findFiles(dir, '.tsx'), ...findFiles(dir, '.js')]) {
    const text = fs.readFileSync(file, 'utf-8');

    if (!text.includes('.register(')) {
      continue;
    }

    for (const m of text.matchAll(CREATOR_RE)) creators.add(m[2]);
    for (const m of text.matchAll(PACK_RE)) packs.add(m[2]);
  }

  return creators.size === 1 && packs.size === 1
    ? `${[...creators][0]}_${[...packs][0]}`
    : undefined;
};

let namespace = settings.namespace;

if (namespace) {
  if (!/^[a-z0-9_]+$/.test(namespace)) {
    console.error(`❌ ui-compile: namespace "${namespace}" must be lowercase a-z, 0-9 and _`);
    process.exit(1);
  }
} else {
  namespace = scanNamespace(path.resolve(SOURCE_DIR));

  if (namespace === undefined) {
    console.error(
      '❌ ui-compile: no namespace — set the "namespace" setting, '
      + 'or write creator/pack as string literals in core.register()',
    );
    process.exit(1);
  }
}

console.log(`🏷️  ui-compile: namespace "${namespace}"`);

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

/**
 * Relays a failure the way the compiler worded it, and stops the build.
 *
 * The compiler's own errors already say what to do — an unsupported control
 * lists what is supported, an oversized screen gives the canvas. Relaying the
 * message unchanged beats wrapping it.
 */
const fail = (context, error) => {
  console.error(`❌ ui-compile: ${context}`);
  console.error(String(error instanceof Error ? error.message : error));
  process.exit(1);
};

const outputDir = path.resolve(OUTPUT_DIR);

fs.mkdirSync(outputDir, { recursive: true });

/** @type {import('./lib/load.js').CompiledScreen[]} */
const compiled = [];

// Every bundle carries the project's own library, and its exports are the same
// from one screen to the next; the last one loaded speaks for all of them.
/** @type {import('./lib/load.js').ScreenBundle} */
let library;

for (const [index, screenPath] of screenPaths.entries()) {
  const name = names[index];
  const layoutId = index + 1;

  try {
    library = await loadScreen({
      screenPath,
      name,
      namespace,
      layoutId,
      cacheDir,
      jsxImportSource: JSX_IMPORT_SOURCE,
    });
  } catch (error) {
    fail(rel(screenPath), error);
  }

  const screen = library.compiled;

  if (screen.layoutId > library.maxLayout) {
    fail(rel(screenPath), `layout key ${screen.layoutId} is past ${library.maxLayout}, the highest the runtime can address`);
  }

  const header = [
    '// GENERATED by the ui-compile filter — do not edit.',
    `// Source: ${rel(screenPath)}`,
    '',
  ].join('\n');

  fs.writeFileSync(
    path.join(outputDir, `${name}.json`),
    `${header}${JSON.stringify(screen.document, null, '\t')}\n`,
    'utf-8',
  );

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
// character at a time: each cell reads its slot's stack size and localizes a
// key built from it. This is the table that turns those codes back into glyphs.
//
// It comes from the project's runtime rather than from here because it is the
// contract between the compiler and the runtime — they encode against the same
// list or nothing renders — and it lands in the WORKSPACE, never in the user's
// own texts/.
if (compiled.some(screen => screen.hasText)) {
  const textsDir = path.resolve(TEXTS_DIR);
  const lines = library.lang;

  fs.mkdirSync(textsDir, { recursive: true });

  for (const file of fs.readdirSync(textsDir).filter(name => name.endsWith('.lang'))) {
    const target = path.join(textsDir, file);
    const existing = fs.readFileSync(target, 'utf-8');

    // Guarded on the first line the table actually produces, so a rebuild over
    // a workspace that already carries it does not append it again.
    if (lines[0] !== undefined && existing.includes(lines[0])) {
      continue;
    }

    fs.writeFileSync(
      target,
      [
        existing.replace(/\s*$/, ''),
        '',
        '## Generated by the ui-compile filter -- the character table live text',
        '## is decoded through. One slot carries one code; the label localizes',
        '## this key and the value below is what gets drawn.',
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

const routerFile = path.resolve(ROUTER_FILE);

let router;

try {
  router = library.buildRouter(compiled);
} catch (error) {
  fail(rel(routerFile), error);
}

fs.mkdirSync(path.dirname(routerFile), { recursive: true });

fs.writeFileSync(
  routerFile,
  '// GENERATED by the ui-compile filter — do not edit.\n'
  + '// Gates every compiled layout onto the vanilla chest screen.\n'
  + '//\n'
  + '// This has to be the file vanilla itself owns. JSON UI resolves a definition\n'
  + '// from the file that owns it, so replacing `chest.small_chest_panel` from any\n'
  + '// other path — same namespace or not — is silently ignored, and the ordinary\n'
  + '// chest renders instead.\n'
  + `${JSON.stringify(router, null, '\t')}\n`,
  'utf-8',
);

console.log(`   ↳ router → ${rel(routerFile)}`);

// ---------------------------------------------------------------------------
// _ui_defs.json
// ---------------------------------------------------------------------------

// The router sits at vanilla's own path, which puts it in the pack's UI root —
// the directory `_ui_defs.json` lives in.
const added = registerUiDefs({
  uiDefsFile: path.join(path.dirname(routerFile), '_ui_defs.json'),
  files: [routerFile, ...compiled.map(screen => path.join(outputDir, `${screen.name}.json`))],
});

if (added > 0) {
  console.log(`   ↳ registered ${added} file(s) in _ui_defs.json`);
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

// A screen names the entity it opens from; the compiler knows how many slots
// that needs, and the router which key picks it. Stamping both here means
// nobody keeps `inventory_size` or a layout key in step with a layout by hand —
// the failure mode of which is a screen that silently draws cells the container
// does not have, or an entity that opens the wrong screen.
const entityFiles = findFiles(path.resolve(ENTITY_DIR), '.json');

/** The workspace definition of the entity with this identifier, if there is one. */
const findEntity = identifier => entityFiles.find(
  file => readJsonc(file)['minecraft:entity']?.description?.identifier === identifier,
);

/** @type {Map<string, string>} entity type → the screen that claimed it */
const hosts = new Map();

for (const screen of compiled) {
  const claimed = hosts.get(screen.entity);

  if (claimed !== undefined) {
    console.error(`❌ ui-compile: ${claimed} and ${screen.name} both name entity "${screen.entity}"; one entity opens one screen`);
    process.exit(1);
  }

  hosts.set(screen.entity, screen.name);

  const match = findEntity(screen.entity);

  if (!match) {
    console.error(`❌ ui-compile: ${screen.name} names entity "${screen.entity}", which is not in ${ENTITY_DIR}`);
    process.exit(1);
  }

  const definition = readJsonc(match);
  const entity = definition['minecraft:entity'];
  const components = entity.components ??= {};
  const inventory = components['minecraft:inventory'] ??= {};

  // `container` is the only container_type that routes to the chest screen, and
  // `private: true` stops the player opening it at all.
  inventory.container_type = 'container';
  inventory.inventory_size = screen.allocation.size;
  inventory.private = false;

  // The entity carries its own layout key: the runtime reads this property when
  // a player opens it, so a screen is never looked up by entity type.
  const properties = entity.description.properties ??= {};

  properties[library.layoutProperty] = {
    type: 'int',
    range: [0, library.maxLayout],
    default: screen.layoutId,
  };

  fs.writeFileSync(match, `${JSON.stringify(definition, null, '\t')}\n`, 'utf-8');

  console.log(
    `   ↳ ${screen.entity}: inventory_size ${screen.allocation.size}, ${library.layoutProperty} = ${screen.layoutId}`,
  );
}
