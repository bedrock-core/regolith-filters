// The filter is driven exactly as Regolith drives it: ROOT_DIR plus a working directory that
// holds BP/ and RP/, with the settings object as argv[2]. Everything asserted here is either
// the merge contract (TypeScript's `extends` rules) or the guarantee that variants never ship.

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, describe, it } = require('node:test');

const MAIN = path.join(__dirname, '..', 'main.js');

const BASE = {
  format_version: 2,
  header: {
    name: 'pack.name',
    uuid: '8f2f4e21-6a3d-4c58-b0aa-51e9d3a7c402',
    version: [0, 1, 0],
    min_engine_version: [1, 26, 30],
  },
  modules: [
    { type: 'data', uuid: '27c15c3e-98be-4dcf-8f1e-b20d7a4e6631', version: [0, 1, 0] },
    { type: 'script', language: 'javascript', entry: 'scripts/main.js', uuid: 'c4a4708e', version: [0, 1, 0] },
  ],
  dependencies: [
    { uuid: '5e0e2a5b-74e2-4dd6-9c11-8a4f3f6b2d90', version: [0, 1, 0] },
    { module_name: '@minecraft/server', version: '2.8.0' },
  ],
  metadata: { product_type: 'addon' },
};

let root;

function workspace(files) {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-manifest-'));

  for (const [rel, contents] of Object.entries(files)) {
    const file = path.join(root, rel);

    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof contents === 'string' ? contents : JSON.stringify(contents, null, 4));
  }

  return root;
}

function run(settings) {
  return execFileSync(process.execPath, settings === undefined ? [MAIN] : [MAIN, JSON.stringify(settings)], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, ROOT_DIR: root },
  });
}

/** Run expecting a non-zero exit, and hand back everything the filter printed. */
function runFails(settings) {
  try {
    run(settings);
  } catch (error) {
    return `${error.stdout ?? ''}${error.stderr ?? ''}`;
  }

  return assert.fail('expected the filter to exit non-zero'); 
}

const read = rel => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
const exists = rel => fs.existsSync(path.join(root, rel));

afterEach(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true });
  root = undefined;
});

describe('selecting a variant', () => {
  it('merges objects key by key and replaces arrays outright', () => {
    workspace({
      'BP/manifest.json': BASE,
      'BP/manifest.test.json': {
        extends: './manifest.json',
        header: { name: 'DEV pack' },
        dependencies: [
          { module_name: '@minecraft/server', version: '2.9.0-beta' },
          { module_name: '@minecraft/server-gametest', version: '1.0.0-beta' },
        ],
      },
    });

    run({ manifestPath: 'BP/manifest.test.json' });

    const result = read('BP/manifest.json');

    // header: the child's key wins, every other key survives.
    assert.equal(result.header.name, 'DEV pack');
    assert.equal(result.header.uuid, BASE.header.uuid);
    assert.deepEqual(result.header.min_engine_version, [1, 26, 30]);

    // dependencies: replaced wholesale, so the base's pack dependency is gone by design.
    assert.deepEqual(result.dependencies, [
      { module_name: '@minecraft/server', version: '2.9.0-beta' },
      { module_name: '@minecraft/server-gametest', version: '1.0.0-beta' },
    ]);

    // untouched keys come straight from the base.
    assert.deepEqual(result.modules, BASE.modules);
    assert.deepEqual(result.metadata, { product_type: 'addon' });
    assert.equal(result.extends, undefined);
  });

  it('resolves a multi-level chain deepest ancestor first', () => {
    workspace({
      'BP/manifest.json': BASE,
      'BP/manifest.dev.json': { extends: './manifest.json', header: { name: 'dev' }, metadata: { authors: ['a'] } },
      'BP/manifest.test.json': { extends: './manifest.dev.json', header: { name: 'test' } },
    });

    run({ manifestPath: 'BP/manifest.test.json' });

    const result = read('BP/manifest.json');

    assert.equal(result.header.name, 'test');
    assert.deepEqual(result.metadata, { product_type: 'addon', authors: ['a'] });
    assert.equal(result.header.uuid, BASE.header.uuid);
  });

  it('accepts a packs/-prefixed path, since that is how projects spell it', () => {
    workspace({ 'BP/manifest.json': BASE, 'BP/manifest.test.json': { extends: './manifest.json', format_version: 3 } });

    run({ manifestPath: 'packs/BP/manifest.test.json' });

    assert.equal(read('BP/manifest.json').format_version, 3);
  });

  it('resolves one manifest per pack when given an array', () => {
    workspace({
      'BP/manifest.json': BASE,
      'BP/manifest.test.json': { extends: './manifest.json', header: { name: 'bp-test' } },
      'RP/manifest.json': BASE,
      'RP/manifest.test.json': { extends: './manifest.json', header: { name: 'rp-test' } },
    });

    run({ manifestPath: ['BP/manifest.test.json', 'RP/manifest.test.json'] });

    assert.equal(read('BP/manifest.json').header.name, 'bp-test');
    assert.equal(read('RP/manifest.json').header.name, 'rp-test');
  });
});

describe('variants never ship', () => {
  it('removes every variant, including packs the profile did not name', () => {
    workspace({
      'BP/manifest.json': BASE,
      'BP/manifest.test.json': { extends: './manifest.json' },
      'BP/manifest.dev.json': { extends: './manifest.json' },
      'RP/manifest.json': BASE,
      'RP/manifest.test.json': { extends: './manifest.json' },
    });

    run();

    assert.ok(exists('BP/manifest.json'));
    assert.ok(exists('RP/manifest.json'));
    assert.equal(exists('BP/manifest.test.json'), false);
    assert.equal(exists('BP/manifest.dev.json'), false);
    assert.equal(exists('RP/manifest.test.json'), false);
  });

  it('leaves files that only look like variants alone', () => {
    workspace({
      'BP/manifest.json': BASE,
      'BP/manifest.json.bak': '{}',
      'BP/other.json': '{}',
    });

    run();

    assert.ok(exists('BP/manifest.json.bak'));
    assert.ok(exists('BP/other.json'));
  });

  it('is a no-op on content when no variant is selected', () => {
    workspace({ 'BP/manifest.json': BASE });

    run();

    assert.deepEqual(read('BP/manifest.json'), BASE);
  });
});

describe('failures', () => {
  it('rejects a circular chain', () => {
    workspace({
      'BP/manifest.a.json': { extends: './manifest.b.json' },
      'BP/manifest.b.json': { extends: './manifest.a.json' },
    });

    assert.match(runFails({ manifestPath: 'BP/manifest.a.json' }), /Circular extends chain/);
  });

  it('names the file that referenced a missing parent', () => {
    workspace({ 'BP/manifest.test.json': { extends: './nope.json' } });

    const output = runFails({ manifestPath: 'BP/manifest.test.json' });

    assert.ok(output.includes('Manifest not found: BP/nope.json'), output);
    assert.ok(output.includes('Referenced by "extends" in BP/manifest.test.json'), output);
  });

  it('points at the array form when a second run finds its variant already swept', () => {
    workspace({
      'BP/manifest.json': BASE,
      'BP/manifest.test.json': { extends: './manifest.json' },
      'RP/manifest.json': BASE,
      'RP/manifest.test.json': { extends: './manifest.json' },
    });

    // Listing the filter twice: the BP run sweeps RP's variant before the RP run can read it.
    run({ manifestPath: 'BP/manifest.test.json' });

    const output = runFails({ manifestPath: 'RP/manifest.test.json' });

    assert.ok(output.includes('Manifest not found: RP/manifest.test.json'), output);
    assert.ok(output.includes('ONE manifestPath array'), output);
  });

  it('rejects a non-relative extends', () => {
    workspace({ 'BP/manifest.json': BASE, 'BP/manifest.test.json': { extends: 'manifest.json' } });

    assert.match(runFails({ manifestPath: 'BP/manifest.test.json' }), /must be a relative path/);
  });

  it('rejects a merged result Minecraft would not load', () => {
    workspace({ 'BP/manifest.test.json': { header: { name: 'x' } } });

    const output = runFails({ manifestPath: 'BP/manifest.test.json' });

    assert.match(output, /"format_version" is missing/);
    assert.match(output, /"header.uuid" is missing/);
  });

  it('rejects two entries that would write the same file', () => {
    workspace({ 'BP/manifest.json': BASE, 'BP/manifest.test.json': { extends: './manifest.json' } });

    const output = runFails({ manifestPath: ['BP/manifest.json', 'BP/manifest.test.json'] });

    assert.ok(output.includes('both resolve to BP/manifest.json'), output);
  });

  it('writes nothing when a later entry fails to resolve', () => {
    workspace({
      'BP/manifest.json': BASE,
      'BP/manifest.test.json': { extends: './manifest.json', header: { name: 'bp-test' } },
      'RP/manifest.test.json': { extends: './missing.json' },
    });

    runFails({ manifestPath: ['BP/manifest.test.json', 'RP/manifest.test.json'] });

    assert.equal(read('BP/manifest.json').header.name, 'pack.name');
    assert.equal(exists('RP/manifest.json'), false);
    assert.ok(exists('BP/manifest.test.json'), 'a failed run must not sweep variants either');
  });

  it('refuses to run outside Regolith', () => {
    workspace({ 'BP/manifest.json': BASE });

    let output = '';

    try {
      execFileSync(process.execPath, [MAIN], { cwd: root, encoding: 'utf8', env: { ...process.env, ROOT_DIR: '' } });
    } catch (error) {
      output = `${error.stdout ?? ''}${error.stderr ?? ''}`;
    }

    assert.match(output, /ROOT_DIR environment variable not set/);
  });
});
