// @bedrock-core/regolith-filters — core
//
// Runs the whole Bedrock Core filter stack as one Regolith filter, in the only
// order the stack supports:
//
//   1. manifest    — pick the profile's manifest variant before anything reads it
//   2. generator   — opt-in: templates become JSON before the scripts are bundled
//   3. guides      — guide keys must land before i18n collects them
//   4. i18n        — .lang files and the runtime bundle
//   5. ui-compiler  — screens bake against the keys i18n emitted
//   6. bundler     — last: it inlines the generated bundles and strips the sources
//
// The order is fixed. A project that needs a step of its own between two stages
// lists the filters one by one in `config.json` and puts its own filter where it
// belongs.
//
// Every stage runs in its own Node process, exactly as Regolith runs it: same
// cwd (the temp workspace), same ROOT_DIR, same `argv[2]` settings JSON, same
// exit code. This filter only assembles the settings and enforces the order.
//
// A stage whose inputs are absent reports that it has nothing to do and the run
// continues, so the stack is safe for a project that uses part of it.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Every filter of this repository the stack runs, in the order it runs them. */
const STAGES = ['manifest', 'generator', 'guides', 'i18n', 'ui-compiler', 'bundler'] as const;

/**
 * The generator writes schema types into the project, so it runs only when the
 * profile names it. Every other stage runs unless its key is `false`.
 */
const OPT_IN: Stage = 'generator';

type Stage = (typeof STAGES)[number];

/** Settings Regolith passes as argv[2]. */
interface Settings {
  /** Settings merged into every stage — where `namespace` belongs. */
  shared?: Record<string, unknown>;
  /** Per-stage settings, merged over `shared`. `false` skips the stage. */
  [stage: string]: unknown;
}

const filterDir = path.dirname(fileURLToPath(import.meta.url));

if (!process.env['ROOT_DIR']) {
  console.error('❌ ROOT_DIR environment variable not set');
  console.error('This filter must be run by Regolith');
  process.exit(1);
}

function fail(message: string, detail?: string): never {
  console.error(`❌ ${message}`);
  if (detail) console.error(`   ${detail}`);
  process.exit(1);
}

function isStage(value: unknown): value is Stage {
  return typeof value === 'string' && (STAGES as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readSettings(): Settings {
  if (!process.argv[2]) return {};
  try {
    return JSON.parse(process.argv[2]) as Settings;
  } catch (err) {
    fail('settings are not valid JSON', err instanceof Error ? err.message : String(err));
  }
}

const settings = readSettings();

for (const key of Object.keys(settings)) {
  if (key === 'shared' || isStage(key)) continue;
  fail(`unknown setting "${key}"`, `expected "shared" or one of: ${STAGES.join(', ')}`);
}

const shared = settings.shared ?? {};

if (!isRecord(shared)) fail('"shared" must be an object');

/** One process to run: the script and the settings it is handed. */
interface Step {
  stage: Stage;
  script: string;
  settings: Record<string, unknown>;
}

/** Builds the step for a stage, or nothing when the profile leaves it out. */
function plan(stage: Stage): Step | null {
  const own = settings[stage];

  if (own === false) return null;
  if (own === undefined) {
    if (stage === OPT_IN) return null;
  } else if (!isRecord(own) && !(own === true && stage === OPT_IN)) {
    fail(
      `"${stage}" must be an object or false`,
      stage === OPT_IN ? 'or true, to run it with its defaults' : undefined,
    );
  }

  // Each stage's entry point sits beside this one, in its own filter folder.
  const script = path.join(filterDir, '..', stage, 'main.ts');

  if (!fs.existsSync(script)) {
    fail(
      `the "${stage}" filter is not installed beside this one`,
      `expected ${script} — the core filter runs the other filters of this repository, so install the whole set, not core alone`,
    );
  }

  return { stage, script, settings: { ...shared, ...(isRecord(own) ? own : {}) } };
}

function run(step: Step): void {
  const args = Object.keys(step.settings).length > 0
    ? [step.script, JSON.stringify(step.settings)]
    : [step.script];

  console.log(`▶️  ${step.stage}`);

  const result = spawnSync(process.execPath, args, { cwd: process.cwd(), stdio: 'inherit' });

  if (result.error) fail(`could not run "${step.stage}"`, result.error.message);
  if (result.signal) fail(`"${step.stage}" was killed by ${result.signal}`);
  if (result.status !== 0) {
    console.error(`❌ "${step.stage}" failed`);
    process.exit(result.status ?? 1);
  }
}

const steps = STAGES.map(plan).filter((entry): entry is Step => entry !== null);

for (const entry of steps) run(entry);

const ran = steps.map(entry => entry.stage);

console.log(ran.length > 0 ? `✨ Stack complete — ${ran.join(' → ')}` : '✨ Stack complete — every stage was skipped');
