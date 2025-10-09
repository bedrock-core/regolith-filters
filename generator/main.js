const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { globSync } = require("glob");
const esbuild = require("esbuild");
const json5 = require("json5");

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
};

const argParsed = process.argv[2] ? JSON.parse(process.argv[2]) : {};
const settings = Object.assign({}, defaults, argParsed);
const userProvidedInclude = Object.prototype.hasOwnProperty.call(argParsed, "include");
const userProvidedExclude = Object.prototype.hasOwnProperty.call(argParsed, "exclude");

console.log("🛠️ @bedrock-core/generator");
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
  // allow 'export const params' and 'export default' but disallow import statements
  if (/\bimport\s+[^;]+;/.test(source) || /\brequire\s*\(/.test(source)) {
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

async function main() {
  try {
    console.log("🔎 Scanning for templates...");
    const files = settings.include
      .flatMap((pattern) => globSync(pattern, { ignore: settings.exclude }))
      .filter((f, i, arr) => arr.indexOf(f) === i) // dedupe
      .sort();

    if (files.length === 0) {
      console.log("ℹ️ No .ts templates found.");
      return;
    }

    console.log(`📄 Found ${files.length} file(s)`);
    let total = 0;

    for (const f of files) {
      total += await processTsFile(f);
    }

    console.log(`✨ Generated ${total} JSON file(s).`);
  } catch (e) {
    console.error("❌ Generation failed:", e.message || e);
    process.exit(1);
  }
}

main();

