// Library discovery. A dependency whose package.json declares
//
//   "bedrockCore": { "i18n": { "dir": "./src/i18n", "namespace": "core" } }
//
// contributes translation resources under its namespace branch: its keys are
// emitted into the addon's .lang files, its tree appears under `$.<ns>.*`, and
// its strings ride in the runtime bundle. Several packages may share one
// namespace (the bedrock-core family all publish under `core`) — their trees
// are merged, and a key defined twice with different values is an error.

import fs from 'node:fs';
import path from 'node:path';

const LOCALE_FILE_RE = /^([a-z]{2}_[A-Z]{2})\.ts$/;

/**
 * @param {string} projectRoot
 * @returns {Array<{ name: string, namespace: string, dir: string, pkgDir: string }>}
 */
export function discoverI18nLibs(projectRoot) {
  const pkgPath = path.join(projectRoot, 'package.json');
  if (!fs.existsSync(pkgPath)) return [];

  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  } catch {
    return [];
  }

  const names = [...new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
  ])].sort();

  const libs = [];
  for (const name of names) {
    // Resolve like Node: nearest node_modules first, then ancestors — package
    // managers hoist monorepo dependencies to the workspace root.
    const pkgDir = resolvePackageDir(projectRoot, name);
    if (!pkgDir) continue;
    const libPkgPath = path.join(pkgDir, 'package.json');
    if (!fs.existsSync(libPkgPath)) continue;

    let libPkg;
    try {
      libPkg = JSON.parse(fs.readFileSync(libPkgPath, 'utf-8'));
    } catch {
      continue;
    }

    const decl = libPkg.bedrockCore?.i18n;
    if (decl === undefined) continue;

    if (typeof decl !== 'object' || decl === null || typeof decl.dir !== 'string' || typeof decl.namespace !== 'string') {
      throw new Error(`${name}: "bedrockCore.i18n" must be an object { dir, namespace }`);
    }
    if (!/^[a-z0-9_]+$/.test(decl.namespace)) {
      throw new Error(`${name}: bedrockCore.i18n.namespace "${decl.namespace}" must be lowercase a-z0-9_`);
    }

    libs.push({ name, namespace: decl.namespace, dir: path.join(pkgDir, decl.dir), pkgDir });
  }

  return libs;
}

/** Walk `start` and its ancestors for `node_modules/<name>` with a package.json. */
function resolvePackageDir(start, name) {
  const segments = name.split('/');
  let dir = start;

  for (;;) {
    const candidate = path.join(dir, 'node_modules', ...segments);
    if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * The locale resource files a library ships, keyed by locale code.
 *
 * @param {{ dir: string }} lib
 * @returns {Map<string, string>} locale → absolute file path
 */
export function libLocaleFiles(lib) {
  const out = new Map();
  if (!fs.existsSync(lib.dir)) return out;
  for (const entry of fs.readdirSync(lib.dir)) {
    const m = LOCALE_FILE_RE.exec(entry);
    if (m) out.set(m[1], path.join(lib.dir, entry));
  }
  return out;
}
