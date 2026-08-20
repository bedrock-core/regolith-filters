const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { globSync } = require("glob");
const esbuild = require("esbuild");
const json5 = require("json5");

const { ensureSchemaPackage, PACKAGE_NAME } = require("./lib/schemas");
const { compileCatalog, indexDtsText, globalsDtsText, TYPES_REVISION } = require("./lib/dts");

/** Where the category tag from `defineTemplate`/`defineMany` is stashed. */
const TEMPLATE_CATEGORY = Symbol.for("@bedrock-core/generator.category");

const projectRoot = process.env.ROOT_DIR;

if (!projectRoot) {
  console.error("❌ ROOT_DIR environment variable not set");
  console.error("This filter must be run by Regolith");
  process.exit(1);
}

// Settings via args (optional)
const defaults = {
  include: ["BP/**/*.ts", "RP/**/*.ts"],
  exclude: ["BP/scripts/**", "**/*.d.ts"],
  pretty: true,
  types: true,
  schemaVersion: "latest",
  typesDir: null,
  strict: false,
  typePrefix: "",
  maxAgeHours: 24,
};

const argParsed = process.argv[2] ? JSON.parse(process.argv[2]) : {};
const settings = Object.assign({}, defaults, argParsed);
const userProvidedInclude = Object.prototype.hasOwnProperty.call(argParsed, "include");
const userProvidedExclude = Object.prototype.hasOwnProperty.call(argParsed, "exclude");

console.log("🛠️  @bedrock-core/generator");
console.log("📂 Project root:", projectRoot);
console.log("📂 Working directory (temp):", process.cwd());

function mapPackPathToTemp(p) {
  if (!p || typeof p !== "string") return null;
  let rel = p.replace(/\\/g, "/");
  if (rel.startsWith("./")) rel = rel.slice(2);
  if (rel.startsWith("/")) rel = rel.slice(1);
  // Regolith temp usually flattens packs/ to root
  rel = rel.replace(/^packs\//, "");
  return rel.replace(/\/$/, "");
}

function resolvePackDirsFromConfig() {
  try {
    const cfgPath = path.join(projectRoot, "config.json");
    if (!fs.existsSync(cfgPath)) {
      console.warn("⚠️ config.json not found in project root; using defaults BP/RP");
      return { bp: "BP", rp: "RP" };
    }
    const raw = fs.readFileSync(cfgPath, "utf8");
    const cfg = json5.parse(raw);
    const bpRaw = cfg?.packs?.behaviorPack;
    const rpRaw = cfg?.packs?.resourcePack;
    const bp = mapPackPathToTemp(bpRaw) || "BP";
    const rp = mapPackPathToTemp(rpRaw) || "RP";
    return { bp, rp };
  } catch (e) {
    console.warn("⚠️ Failed to read packs from config.json; using defaults BP/RP:", e.message);
    return { bp: "BP", rp: "RP" };
  }
}

const { bp: bpDir, rp: rpDir } = resolvePackDirsFromConfig();

// Normalize incoming patterns to match Regolith temp layout
function normalizePattern(p) {
  if (!p || typeof p !== "string") return p;
  let rel = p.replace(/\\/g, "/");
  if (rel.startsWith("./")) rel = rel.slice(2);
  if (rel.startsWith("/")) rel = rel.slice(1);
  // Regolith temp usually flattens packs/ to root
  rel = rel.replace(/^packs\//, "");
  return rel;
}

// If user did not provide include/exclude, derive sensible defaults from resolved pack dirs
if (!userProvidedInclude) {
  settings.include = [
    `${bpDir.replace(/\\/g, "/")}/**/*.ts`,
    `${rpDir.replace(/\\/g, "/")}/**/*.ts`,
  ];
}
if (!userProvidedExclude) {
  settings.exclude = [
    `${bpDir.replace(/\\/g, "/")}/scripts/**`,
    "**/*.d.ts",
  ];
}

// Coerce to arrays and normalize paths for temp workspace
if (typeof settings.include === "string") settings.include = [settings.include];
if (typeof settings.exclude === "string") settings.exclude = [settings.exclude];
settings.include = (settings.include || []).map(normalizePattern);
settings.exclude = (settings.exclude || []).map(normalizePattern);

console.log("📦 Packs (temp):", { BP: bpDir, RP: rpDir });

function assertNoImports(source, file) {
  // Simple guard: if the file contains import/export from other modules, block it
  // allow 'export const params' and 'export default' but disallow import statements.
  // `import type` is exempt: esbuild erases it during transpile, so it never
  // reaches the sandbox — and it is what lets templates pull in the generated
  // Minecraft schema types.
  // Matched up to the module specifier rather than to a semicolon, so that
  // multi-line and semicolon-less type imports are both recognised.
  const runtime = source.replace(/\bimport\s+type\b[\s\S]*?from\s*['"][^'"]+['"]\s*;?/g, "");

  if (/\bimport\s+[^;]+;/.test(runtime) || /\brequire\s*\(/.test(runtime)) {
    throw new Error(`Imports are not allowed in template files: ${file}`);
  }
}

function isBasename(name) {
  return name && name === path.basename(name) && !name.includes("..") && name.trim() !== "";
}

async function transpileTsToCjs(source, file) {
  try {
    const result = await esbuild.transform(source, {
      loader: "ts",
      format: "cjs",
      target: "es2020",
      sourcemap: false,
      legalComments: "none",
    });
    return result.code;
  } catch (e) {
    throw new Error(`Failed to transpile ${file}: ${e.message}`);
  }
}

/**
 * `defineTemplate` / `defineMany` exist so templates get a place to hang a
 * category tag — the tag is what lets TypeScript pick the right Minecraft
 * document type and infer the item parameter of the callbacks. At runtime they
 * are almost identity functions; the tag is kept as a non-enumerable property
 * so it never lands in the emitted JSON but stays available for validation.
 */
function makeTemplateHelpers() {
  const tag = (value, category) => {
    if (category && value && typeof value === "object") {
      Object.defineProperty(value, TEMPLATE_CATEGORY, { value: category, enumerable: false });
    }
    return value;
  };

  return {
    defineTemplate: (categoryOrData, maybeData) =>
      typeof categoryOrData === "string" ? tag(maybeData, categoryOrData) : categoryOrData,

    defineMany: (...args) => {
      const category = typeof args[0] === "string" ? args.shift() : null;
      const [nameFn, dataFn, items] = args;
      return tag([nameFn, dataFn, items], category);
    },
  };
}

function evaluateModule(cjsCode, file) {
  const sandbox = {
    module: { exports: {} },
    exports: null,
    require: () => {
      throw new Error(`require() is disabled in templates: ${file}`);
    },
    console,
    process: { env: {} },
    setTimeout,
    clearTimeout,
    Buffer,
    ...makeTemplateHelpers(),
  };
  // Link exports to module.exports just like Node's CJS wrapper
  sandbox.exports = sandbox.module.exports;

  const context = vm.createContext(sandbox);
  const wrapper = `(function(){\n${cjsCode}\n})();`;

  try {
    const script = new vm.Script(wrapper, { filename: file });
    script.runInContext(context);

    return sandbox.module.exports;
  } catch (e) {
    throw new Error(`Failed to evaluate ${file}: ${e.message}`);
  }
}

async function processTsFile(file) {
  const rel = file;
  const dir = path.dirname(rel);
  const base = path.basename(rel, ".ts");

  const source = fs.readFileSync(rel, "utf8");
  assertNoImports(source, rel);
  const cjs = await transpileTsToCjs(source, rel);
  const mod = evaluateModule(cjs, rel);
  const def = mod && mod.default;

  // Single format -> same name as file
  if (def && typeof def === "object" && !Array.isArray(def)) {
    const outFile = path.join(dir, `${base}.json`);
    const json = settings.pretty ? JSON.stringify(def, null, 4) : JSON.stringify(def);

    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(outFile, json);

    console.log(`   ✓ ${rel} -> ${path.relative(".", outFile)}`);

    return 1;
  }

  // Multiple format: default export must be an array [nameFn, dataFn, items]
  if (Array.isArray(def)) {
    if (def.length !== 3) {
      throw new Error(`Invalid default export array in ${rel}. Expected [nameFn, dataFn, items] (3 items).`);
    }
    const [nameFn, dataFn, items] = def;
    if (typeof nameFn !== "function") {
      throw new Error(`First element must be a function that returns a filename in ${rel}.`);
    }
    if (typeof dataFn !== "function") {
      throw new Error(`Second element must be a function that returns JSON data in ${rel}.`);
    }
    if (!Array.isArray(items)) {
      throw new Error(`Third element must be an array of items to generate from in ${rel}.`);
    }

    let count = 0;

    for (let i = 0; i < items.length; i++) {
      const p = items[i];

      let fileName = nameFn(p);

      if (fileName && typeof fileName.then === "function") {
        fileName = await fileName;
      }

      if (typeof fileName !== "string" || !fileName.trim()) {
        throw new Error(`Name generator must return a non-empty string for item ${i + 1} in ${rel}.`);
      }

      if (!isBasename(fileName)) {
        throw new Error(`Invalid filename '${fileName}' in ${rel}. Use a basename without directories.`);
      }

      const finalName = fileName.endsWith(".json") ? fileName : `${fileName}.json`;

      let data = dataFn(p);

      if (data && typeof data.then === "function") {
        data = await data;
      }

      const outFile = path.join(dir, finalName);
      const json = settings.pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);

      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(outFile, json);

      console.log(`   ✓ ${rel} (${i + 1}/${items.length}) -> ${path.relative(".", outFile)}`);
      count++;
    }

    return count;
  }

  // If we got here, no supported pattern matched
  throw new Error(
    `Unsupported template in ${rel}. Expected either: \n` +
    ` - default export object (single file), or\n` +
    ` - default export array [nameFn, dataFn, items] for multiple files.`
  );
}

/**
 * The generated .d.ts files are what the IDE reads, so they go to the real
 * project rather than Regolith's temp copy — and only when the content
 * actually changed, so watch mode does not re-trigger itself.
 */
function writeProjectFileIfChanged(relPath, content) {
  const abs = path.join(projectRoot, relPath);
  if (fs.existsSync(abs) && fs.readFileSync(abs, "utf8") === content) return false;
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf8");
  return true;
}

/** Regolith's data path on real disk (packs/data unless the project moved it). */
function projectDataPath() {
  try {
    const cfg = json5.parse(fs.readFileSync(path.join(projectRoot, "config.json"), "utf8"));
    if (typeof cfg?.regolith?.dataPath === "string") return cfg.regolith.dataPath;
  } catch {
    // fall through to the default
  }
  return "packs/data";
}

/**
 * Download the official Mojang schemas (cached) and compile them into the
 * project. Skipped entirely when the marker already records the same schema
 * package version and settings, so only the first build after a version bump
 * pays for it.
 */
async function generateTypes() {
  const outRel = (settings.typesDir || path.posix.join(projectDataPath(), "generated", "mc"))
    .replace(/\\/g, "/")
    .replace(/\/$/, "");
  const outAbs = path.join(projectRoot, outRel);
  const cacheDir = path.join(projectRoot, ".regolith", "cache", "generator");
  const markerFile = path.join(outAbs, ".generated");

  const log = (msg) => console.log(`   ${msg}`);

  console.log("🧬 Preparing Minecraft schema types...");

  const { version, root: pkgRoot } = await ensureSchemaPackage({
    version: String(settings.schemaVersion || "latest"),
    cacheDir,
    maxAgeHours: Number(settings.maxAgeHours) || 24,
    log,
  });

  // `rev` is what makes an upgrade of the filter itself regenerate types that
  // were emitted by an older revision, even when the schema version is unchanged.
  const marker = `${version} strict=${settings.strict ? 1 : 0} prefix=${settings.typePrefix || ""} rev=${TYPES_REVISION}`;
  if (fs.existsSync(markerFile) && fs.readFileSync(markerFile, "utf8") === marker) {
    console.log(`   ✅ types already up to date (${PACKAGE_NAME}@${version})`);
    return;
  }

  // A stale tree would leave types for categories the new version dropped, so
  // the directory is rebuilt from scratch — but only once it is confirmed to be
  // ours. `typesDir` is user-supplied, and pointing it at an existing folder
  // must not delete that folder's contents.
  if (fs.existsSync(outAbs)) {
    if (!fs.existsSync(markerFile) && fs.readdirSync(outAbs).length > 0) {
      throw new Error(
        `Refusing to overwrite ${outRel} — it already has content and was not written by this filter. ` +
          `Point 'typesDir' at a dedicated folder, or empty this one.`,
      );
    }
    fs.rmSync(outAbs, { recursive: true, force: true });
  }

  const categories = await compileCatalog({
    pkgRoot,
    outDir: outAbs,
    strict: Boolean(settings.strict),
    typePrefix: String(settings.typePrefix || ""),
    log,
  });

  if (!categories.length) throw new Error("No schema categories compiled");

  writeProjectFileIfChanged(path.posix.join(outRel, "index.d.ts"), indexDtsText(categories, version));
  writeProjectFileIfChanged(path.posix.join(outRel, "globals.d.ts"), globalsDtsText(categories, String(settings.typePrefix || "")));
  fs.writeFileSync(markerFile, marker, "utf8");

  console.log(`   ✅ ${categories.length} categories -> ${outRel}/`);
  console.log(`   ℹ️  make sure your tsconfig "include" covers ${outRel}/globals.d.ts`);
}

async function main() {
  try {
    if (settings.types) await generateTypes();

    console.log("🔎 Scanning for templates...");
    const files = settings.include
      .flatMap((pattern) => globSync(pattern, { ignore: settings.exclude }))
      .filter((f, i, arr) => arr.indexOf(f) === i) // dedupe
      .sort();

    if (files.length === 0) {
      console.log("ℹ️  No .ts templates found.");
      return;
    }

    console.log(`📄 Found ${files.length} file(s)`);
    let total = 0;
    const processed = [];

    for (const f of files) {
      const generated = await processTsFile(f);
      total += generated;
      processed.push(f);
    }

    console.log(`✨ Generated ${total} JSON file(s).`);

    // Remove processed .ts template files from the temp workspace (not the project root)
    if (processed.length) {
      console.log("🧹 Cleaning up template TypeScript files...");
      for (const f of processed) {
        try {
          if (f.endsWith(".ts")) {
            fs.unlinkSync(f);
            console.log(`   ✓ Removed ${f}`);
          }
        } catch (err) {
          console.warn(`   ⚠ Could not remove ${f}:`, err.message);
        }
      }
    }
  } catch (e) {
    console.error("❌ Generation failed:", e.message || e);
    process.exit(1);
  }
}

main();

