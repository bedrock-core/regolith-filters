// Mojang publishes the official Bedrock JSON Schemas as an npm package. We pull
// the tarball straight from the registry and unpack it under
// .regolith/cache/generator/ rather than adding it to the project's
// dependencies — the filter has to work in a bare Regolith temp workspace where
// no install step ever runs.

const fs = require("fs");
const path = require("path");

const { extractTgz } = require("./tar");

const PACKAGE_NAME = "@minecraft/bedrock-schemas";
const REGISTRY = "https://registry.npmjs.org";

/** Files inside the tarball we actually need. Everything else (forms/, 11 MB of
 *  editor snippets) is dropped on the floor. */
const KEEP = [/^schemas\//, /^types\//, /^catalog\.json$/, /^package\.json$/, /^LICENSE$/];

/**
 * Resolve a `version` setting that may be a dist-tag (`latest`, `beta`) or an
 * exact version, hitting the registry only when it has to.
 *
 * @param {string} version
 * @param {{ metaCacheFile: string, maxAgeHours: number, log(msg: string): void }} opts
 * @returns {Promise<{ version: string, tarball: string }>}
 */
async function resolveVersion(version, { metaCacheFile, maxAgeHours, log }) {
  let meta = null;

  if (fs.existsSync(metaCacheFile)) {
    const ageHours = (Date.now() - fs.statSync(metaCacheFile).mtimeMs) / 3_600_000;
    if (ageHours < maxAgeHours) {
      try {
        meta = JSON.parse(fs.readFileSync(metaCacheFile, "utf8"));
        log(`✅ using cached registry metadata (age: ${ageHours.toFixed(1)}h)`);
      } catch {
        meta = null;
      }
    } else {
      log(`⏳ registry metadata cache expired (${ageHours.toFixed(1)}h old), re-fetching…`);
    }
  }

  if (!meta) {
    const url = `${REGISTRY}/${PACKAGE_NAME}`;
    log(`⏳ fetching ${PACKAGE_NAME} metadata from ${url} …`);

    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} — ${url}`);
    meta = await res.json();

    fs.mkdirSync(path.dirname(metaCacheFile), { recursive: true });
    fs.writeFileSync(metaCacheFile, JSON.stringify(meta), "utf8");
  }

  const resolved = meta["dist-tags"]?.[version] ?? version;
  const entry = meta.versions?.[resolved];

  if (!entry) {
    const tags = Object.keys(meta["dist-tags"] ?? {}).join(", ");
    throw new Error(`Unknown ${PACKAGE_NAME} version '${version}'. Available dist-tags: ${tags}`);
  }

  return { version: resolved, tarball: entry.dist.tarball };
}

/**
 * Make sure the schema package is unpacked in the cache and return its root.
 * Re-uses an existing unpack when the version already matches, so only the
 * first build in a fresh clone pays the download.
 *
 * @param {{ version: string, cacheDir: string, maxAgeHours: number, log(msg: string): void }} opts
 * @returns {Promise<{ version: string, root: string }>}
 */
async function ensureSchemaPackage({ version, cacheDir, maxAgeHours, log }) {
  // An exact version that is already unpacked needs no registry round-trip.
  const exactRoot = path.join(cacheDir, version);
  if (/^\d/.test(version) && fs.existsSync(path.join(exactRoot, ".complete"))) {
    log(`✅ schemas ${version} already cached`);
    return { version, root: exactRoot };
  }

  const { version: resolved, tarball } = await resolveVersion(version, {
    metaCacheFile: path.join(cacheDir, "registry.json.cache"),
    maxAgeHours,
    log,
  });

  const root = path.join(cacheDir, resolved);
  if (fs.existsSync(path.join(root, ".complete"))) {
    log(`✅ schemas ${resolved} already cached`);
    return { version: resolved, root };
  }

  log(`⏳ downloading ${PACKAGE_NAME}@${resolved} …`);
  const res = await fetch(tarball);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} — ${tarball}`);

  const files = extractTgz(Buffer.from(await res.arrayBuffer()));

  fs.rmSync(root, { recursive: true, force: true });

  let written = 0;
  for (const [entry, contents] of files) {
    // Every path in an npm tarball is prefixed with `package/`.
    const rel = entry.replace(/^package\//, "");
    if (rel === entry) continue;
    if (!KEEP.some((re) => re.test(rel))) continue;

    const dest = path.join(root, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, contents);
    written++;
  }

  if (!written) throw new Error(`${PACKAGE_NAME}@${resolved} tarball contained no schema files`);

  fs.writeFileSync(path.join(root, ".complete"), resolved, "utf8");
  log(`✅ unpacked ${PACKAGE_NAME}@${resolved} (${written} files)`);

  return { version: resolved, root };
}

module.exports = { ensureSchemaPackage, PACKAGE_NAME };
