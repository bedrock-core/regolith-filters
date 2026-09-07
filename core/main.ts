// @bedrock-core/regolith-filters — core
//
// Runs the whole Bedrock Core filter stack as one Regolith filter, in the only
// order the stack supports:
//
//   1. manifest    — pick the profile's manifest variant before anything reads it
//   2. guides      — guide keys must land before i18n collects them
//   3. i18n        — .lang files and the runtime bundle
//   4. ui-compile  — screens bake against the keys i18n emitted
//   5. bundler     — last: it inlines the generated bundles and strips the sources
//
// The generator is a stage too, but not a default one: it emits schema types
// into the project, so a project opts into it by naming it in `stages`, before
// the bundler.
//
// Every stage runs in its own Node process, exactly as Regolith runs it: same
// cwd (the temp workspace), same ROOT_DIR, same `argv[2]` settings JSON, same
// exit code. This filter only assembles the settings and enforces the order.
//
// A stage whose inputs are absent reports that it has nothing to do and the run
// continues, so the default stack is safe for a project that uses part of it.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Every filter of this repository the stack can run. */
const STAGES = ['manifest', 'generator', 'guides', 'i18n', 'ui-compile', 'bundler'] as const;

/** What runs when the profile does not name its stages. */
const DEFAULT_STAGES = ['manifest', 'guides', 'i18n', 'ui-compile', 'bundler'] as const;

type Stage = (typeof STAGES)[number];

/**
 * A project's own filter, run in place among the stages — the escape hatch for
 * a step that belongs mid-stack and is not one of this repository's filters.
 */
interface CustomStage {
  /** Node script to run, relative to the project root, as a local filter's `script` is. */
  script: string;
  /** Label for the log line. Defaults to the script's file name. */
  name?: string;
  /** Settings for this script, merged over `shared`. */
  settings?: Record<string, unknown>;
}

type StageSpec = Stage | CustomStage;

/** Settings Regolith passes as argv[2]. */
interface Settings {
  /** Stages to run, in the order given. Defaults to the stack above. */
  stages?: StageSpec[];
  /** Settings merged into every stage — where `namespace` belongs. */
  shared?: Record<string, unknown>;
  /** Per-stage settings, merged over `shared`. `false` skips the stage. */
  [stage: string]: unknown;
}

const filterDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = process.env['ROOT_DIR'];

if (!projectRoot) {
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
  if (key === 'stages' || key === 'shared' || isStage(key)) continue;
  fail(`unknown setting "${key}"`, `expected "stages", "shared" or one of: ${STAGES.join(', ')}`);
}

const shared = settings.shared ?? {};

if (!isRecord(shared)) fail('"shared" must be an object');

const requested: StageSpec[] = settings.stages ?? [...DEFAULT_STAGES];

if (!Array.isArray(requested)) fail('"stages" must be an array');

for (const spec of requested) {
  if (isStage(spec)) continue;
  if (isRecord(spec) && typeof spec['script'] === 'string') continue;
  fail(
    `"stages" entry ${JSON.stringify(spec)} is not a stage`,
    `expected one of ${STAGES.join(', ')}, or an object with a "script" path`,
  );
}

/** One process to run: the script and the settings it is handed. */
interface Step {
  label: string;
  script: string;
  settings: Record<string, unknown> | null;
}

function repositoryStep(stage: Stage): Step {
  const own = settings[stage];

  if (own !== undefined && own !== false && !isRecord(own)) {
    fail(`"${stage}" must be an object or false`);
  }

  // Each stage's entry point sits beside this one, in its own filter folder.
  const script = path.join(filterDir, '..', stage, 'main.ts');

  if (!fs.existsSync(script)) {
    fail(
      `the "${stage}" filter is not installed beside this one`,
      `expected ${script} — the core filter runs the other filters of this repository, so install the whole set, not core alone`,
    );
  }

  return {
    label: stage,
    script,
    settings: own === false ? null : { ...shared, ...own },
  };
}

function customStep(spec: CustomStage): Step {
  if (spec.settings !== undefined && !isRecord(spec.settings)) {
    fail(`the "settings" of ${spec.script} must be an object`);
  }

  // A local filter's script is relative to the project root; so is this one.
  const script = path.resolve(projectRoot!, spec.script);

  if (!fs.existsSync(script)) fail(`no script at ${spec.script}`, `resolved to ${script}`);

  return {
    label: spec.name ?? path.basename(spec.script),
    script,
    settings: { ...shared, ...spec.settings },
  };
}

/** Runs one step, unless the profile skipped it. Returns whether it ran. */
function runStep(step: Step): boolean {
  if (step.settings === null) {
    console.log(`⏭️  ${step.label} — skipped`);
    return false;
  }

  const args = Object.keys(step.settings).length > 0
    ? [step.script, JSON.stringify(step.settings)]
    : [step.script];

  console.log(`▶️  ${step.label}`);

  const result = spawnSync(process.execPath, args, { cwd: process.cwd(), stdio: 'inherit' });

  if (result.error) fail(`could not run "${step.label}"`, result.error.message);
  if (result.signal) fail(`"${step.label}" was killed by ${result.signal}`);
  if (result.status !== 0) {
    console.error(`❌ "${step.label}" failed`);
    process.exit(result.status ?? 1);
  }

  return true;
}

const steps = requested.map(spec => isStage(spec) ? repositoryStep(spec) : customStep(spec as CustomStage));
const ran = steps.filter(runStep).map(step => step.label);

console.log(ran.length > 0 ? `✨ Stack complete — ${ran.join(' → ')}` : '✨ Stack complete — every stage was skipped');
