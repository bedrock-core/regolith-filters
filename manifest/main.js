/**
 * @bedrock-core/manifest — a Regolith filter that picks a manifest variant per profile.
 *
 * A project keeps one committed manifest per build shape — `manifest.json` for what ships,
 * `manifest.test.json` for the gametest build — instead of mutating a single file between
 * builds. The profile names which one to use; this filter resolves its `extends` chain, writes
 * the result as the canonical `manifest.json`, and deletes the variants so they never ship.
 *
 * Merge rules are TypeScript's, so `extends` behaves the way tsconfig trained everyone to expect:
 * objects merge key by key, arrays and scalars in the child replace the parent's value outright,
 * and a relative `extends` resolves against the file that declares it.
 *
 * Everything happens in Regolith's temp workspace (the cwd), never in the project itself.
 */

const fs = require("fs");
const path = require("path");

const projectRoot = process.env.ROOT_DIR;

if (!projectRoot) {
  console.error("❌ ROOT_DIR environment variable not set");
  console.error("This filter must be run by Regolith");
  process.exit(1);
}

const defSettings = {
  manifestPath: "BP/manifest.json",
};

const argParsed = process.argv[2] ? JSON.parse(process.argv[2]) : {};
const settings = Object.assign({}, defSettings, argParsed);

/**
 * Pack roots swept for leftover variants even when nothing was selected from them, so an RP
 * variant can't ship just because the profile only named a BP manifest.
 */
const PACK_ROOTS = ["BP", "RP"];

/** Variants are `manifest.<something>.json`; the canonical name is never one of them. */
const VARIANT_PATTERN = /^manifest\..+\.json$/;

/** Regolith strips the `packs/` prefix when it copies a project into the temp workspace. */
function normalizePath(value) {
  return String(value)
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^packs\//, "");
}

function relative(file) {
  return path.relative(process.cwd(), file).replace(/\\/g, "/");
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function fail(message, ...details) {
  console.error(`❌ ${message}`);
  for (const detail of details) console.error(`   ${detail}`);
  process.exit(1);
}

/**
 * TypeScript's `extends` semantics: the child wins key by key, nested objects merge, and an
 * array or scalar in the child replaces the parent's value outright — never element-wise.
 * Restating a whole array is how a variant adds, re-versions or drops an entry.
 */
function merge(base, child) {
  if (!isPlainObject(base) || !isPlainObject(child)) return child;

  const out = { ...base };

  for (const [key, value] of Object.entries(child)) {
    out[key] = key in base ? merge(base[key], value) : value;
  }

  return out;
}

/**
 * A missing manifest is usually a typo — unless the filter already ran once in this profile, in
 * which case that run swept the variant before this one could read it.
 */
function missingHints(file, parent) {
  if (parent) return [`Referenced by "extends" in ${relative(parent)}.`];

  const hints = ["Check the filter's manifestPath setting."];

  if (fs.existsSync(path.join(path.dirname(file), "manifest.json"))) {
    hints.push(
      "Listing the filter twice in one profile also causes this: the first run sweeps every",
      "variant. Name all of them in ONE manifestPath array instead."
    );
  }

  return hints;
}

function readJson(file, ...hints) {
  if (!fs.existsSync(file)) fail(`Manifest not found: ${relative(file)}`, ...hints);

  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    fail(`Failed to parse ${relative(file)}`, error.message);
  }
}

/** Resolve one manifest and everything it extends, deepest ancestor first. */
function resolveChain(file, ancestors) {
  const abs = path.resolve(file);

  if (ancestors.includes(abs)) {
    fail("Circular extends chain", [...ancestors, abs].map(relative).join(" -> "));
  }

  const parent = ancestors[ancestors.length - 1];
  const doc = readJson(abs, ...missingHints(abs, parent));
  const parentRef = doc.extends;

  delete doc.extends;

  if (parentRef === undefined) return doc;

  if (typeof parentRef !== "string" || !parentRef.startsWith(".")) {
    fail(`Invalid "extends" in ${relative(abs)}`, 'It must be a relative path, such as "./manifest.json".');
  }

  const parentFile = path.resolve(path.dirname(abs), parentRef);

  console.log(`   ↳ ${relative(abs)} extends ${relative(parentFile)}`);

  return merge(resolveChain(parentFile, [...ancestors, abs]), doc);
}

/** Catch the merges that produce a manifest Minecraft would reject outright. */
function validate(doc, file) {
  const problems = [];

  if (doc.format_version === undefined) problems.push('"format_version" is missing');
  if (!isPlainObject(doc.header)) problems.push('"header" is missing');
  else if (!doc.header.uuid) problems.push('"header.uuid" is missing');
  if (doc.modules !== undefined && !Array.isArray(doc.modules)) problems.push('"modules" must be an array');
  if (doc.dependencies !== undefined && !Array.isArray(doc.dependencies)) {
    problems.push('"dependencies" must be an array');
  }

  if (problems.length) fail(`Resolved manifest from ${relative(file)} is not valid`, ...problems);
}

/** Variants are build inputs, not pack content — they must not reach the output. */
function sweepVariants(dirs) {
  const swept = new Set();
  let removed = 0;

  for (const dir of dirs) {
    if (swept.has(dir) || !fs.existsSync(dir)) continue;
    swept.add(dir);

    for (const name of fs.readdirSync(dir)) {
      if (name === "manifest.json" || !VARIANT_PATTERN.test(name)) continue;

      try {
        fs.unlinkSync(path.join(dir, name));
        console.log(`   ✓ Removed ${dir}/${name}`);
        removed += 1;
      } catch (error) {
        console.warn(`   ⚠ Could not remove ${dir}/${name}: ${error.message}`);
      }
    }
  }

  return removed;
}

function main() {
  console.log("📦 @bedrock-core/manifest");

  const requested = Array.isArray(settings.manifestPath) ? settings.manifestPath : [settings.manifestPath];

  if (requested.length === 0) fail("manifestPath is empty", "Name at least one manifest to resolve.");

  const entries = requested.map(normalizePath);
  const claimed = new Map();
  const resolved = [];

  // Resolve every entry before writing any of them: a chain that fails halfway through should
  // leave the workspace untouched rather than half-migrated.
  for (const entry of entries) {
    const source = path.resolve(entry);
    const outFile = path.join(path.dirname(source), "manifest.json");

    if (claimed.has(outFile)) {
      fail(`Two manifestPath entries both resolve to ${relative(outFile)}`, `${claimed.get(outFile)} and ${entry}`);
    }

    claimed.set(outFile, entry);
    console.log(`📄 Resolving ${entry}`);

    const doc = resolveChain(source, []);

    validate(doc, source);
    resolved.push({ doc, outFile });
  }

  for (const { doc, outFile } of resolved) {
    fs.writeFileSync(outFile, `${JSON.stringify(doc, null, 4)}\n`);
    console.log(`   ✅ Wrote ${relative(outFile)}`);
  }

  const removed = sweepVariants([...entries.map(entry => path.dirname(entry)), ...PACK_ROOTS]);

  console.log(removed ? "✨ Manifest resolved, variants cleaned up." : "✨ Manifest resolved.");
}

main();
