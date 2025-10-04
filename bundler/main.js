const { build } = require("esbuild");
const fs = require("fs");
const { globSync } = require("glob");
const json5 = require("json5");
const path = require("path");

/**
 * Esbuild plugin that converts JSON5 to JSON before bundling
 */
const json5Plugin = () => {
  return {
    name: "json5",
    setup(b) {
      b.onResolve({ filter: /\.json$/ }, (args) => {
        return {
          path: path.resolve(args.resolveDir, args.path),
          namespace: "json5",
        };
      });
      b.onLoad({ filter: /.*/, namespace: "json5" }, (args) => {
        const result = fs.readFileSync(args.path, "utf-8");
        const compiled = json5.parse(result);
        const stringed = JSON.stringify(compiled);
        return {
          contents: stringed,
          loader: "json",
        };
      });
    },
  };
};

const projectRoot = process.env.ROOT_DIR;

if (!projectRoot) {
  console.error("❌ ROOT_DIR environment variable not set");
  console.error("This filter must be run by Regolith");
  process.exit(1);
}

// Load settings from arguments
const defSettings = {
  tsConfigPath: "tsconfig.json",
  debug: false,
};
const argParsed = process.argv[2] ? JSON.parse(process.argv[2]) : {};
const settings = Object.assign({}, defSettings, argParsed);

const tsconfigPath = path.join(projectRoot, settings.tsConfigPath);

if (!fs.existsSync(tsconfigPath)) {
  console.error(`❌ tsconfig.json not found at: ${tsconfigPath}`);
  console.error("Please create a tsconfig.json in your project root");
  process.exit(1);
}

console.log("📦 @bedrock-core/bundler");
console.log("📂 Project root:", projectRoot);
console.log("📂 Working directory (temp):", process.cwd());
if (settings.tsConfigPath !== "tsconfig.json") {
  console.log("⚙️  Using custom tsconfig:", settings.tsConfigPath);
}
if (settings.debug) {
  console.log("🐛 Debug mode enabled");
}

/**
 * Load and parse tsconfig.json
 */
function loadTsConfig() {
  try {
    const content = fs.readFileSync(tsconfigPath, "utf-8");
    const config = json5.parse(content);
    console.log("✅ Loaded tsconfig.json");
    return config;
  } catch (error) {
    console.error("❌ Failed to parse tsconfig.json:", error);
    process.exit(1);
  }
}

/**
 * Resolve entry point from tsconfig
 * Since we always bundle to a single file, we need a single entry point
 */
function resolveEntryPoints(tsconfig) {
  let entryPoint = null;

  // Option 1: Use first file from "files" array if specified
  if (tsconfig.files && tsconfig.files.length > 0) {
    const firstFile = tsconfig.files[0];
    // Adjust path from project root to temp folder
    entryPoint = firstFile
      .replace(/\\/g, "/")
      .replace(/^packs\/BP\//, "BP/")
      .replace(/^packs\/RP\//, "RP/")
      .replace(/^packs\//, "");

    if (fs.existsSync(entryPoint)) {
      console.log(`✅ Using entry point from tsconfig.files: ${entryPoint}`);
      return [entryPoint];
    }
  }

  // Option 2: Look for main.ts in common locations based on include patterns
  if (tsconfig.include && tsconfig.include.length > 0) {
    const pattern = tsconfig.include[0]
      .replace(/\\/g, "/")
      .replace(/^packs\/BP\//, "BP/")
      .replace(/^packs\/RP\//, "RP/")
      .replace(/^packs\//, "")
      .replace(/\/\*\*\/\*$/, ""); // Remove /**/* glob

    const possibleEntries = [
      `${pattern}/main.ts`,
      `${pattern}/index.ts`,
    ];

    for (const entry of possibleEntries) {
      if (fs.existsSync(entry)) {
        console.log(`✅ Found entry point: ${entry}`);
        return [entry];
      }
    }
  }

  // Option 3: Fallback - search for any main.ts or index.ts
  const fallbackEntries = [
    "BP/scripts/main.ts",
    "BP/scripts/index.ts",
    "RP/scripts/main.ts",
    "RP/scripts/index.ts",
  ];

  for (const entry of fallbackEntries) {
    if (fs.existsSync(entry)) {
      console.log(`✅ Found entry point (fallback): ${entry}`);
      return [entry];
    }
  }

  // No entry point found
  console.error("❌ No entry point found!");
  console.error("Please specify a single entry point in your tsconfig.json:");
  console.error('  "files": ["packs/BP/scripts/main.ts"]');
  console.error("");
  console.error("Or create one of these files:");
  fallbackEntries.forEach(f => console.error(`  - ${f}`));
  process.exit(1);
}

/**
 * Clean up TypeScript source files from output directory
 */
function cleanupTypeScriptFiles() {
  const outputDir = "BP/scripts";
  if (!fs.existsSync(outputDir)) return;

  console.log("🧹 Cleaning up TypeScript files from", outputDir);

  const tsFiles = globSync("**/*.ts", { cwd: outputDir, nodir: true });
  const dtsFiles = globSync("**/*.d.ts", { cwd: outputDir, nodir: true });

  [...tsFiles, ...dtsFiles].forEach(file => {
    const filePath = path.join(outputDir, file);
    try {
      fs.unlinkSync(filePath);
      console.log(`   ✓ Removed ${file}`);
    } catch (error) {
      console.warn(`   ⚠ Could not remove ${file}:`, error);
    }
  });
}

/**
 * Main execution
 */
async function main() {
  try {
    // Load tsconfig
    const tsconfig = loadTsConfig();

    // Resolve entry points
    const entryPoints = resolveEntryPoints(tsconfig);

    // Configure esbuild
    const outputFile = "BP/scripts/main.js";
    const buildOptions = {
      entryPoints,
      outfile: outputFile,
      bundle: true,
      format: "esm",
      target: tsconfig.compilerOptions?.target?.toLowerCase() || "es2020",
      platform: "neutral",
      minify: !settings.debug,
      sourcemap: settings.debug,
      keepNames: settings.debug,
      // Mark Minecraft modules as external (provided by the game at runtime)
      external: [
        "@minecraft/server",
        "@minecraft/server-ui",
        "@minecraft/server-gametest",
        "@minecraft/server-net",
        "@minecraft/server-admin",
        "@minecraft/debug-utilities",
      ],
    };

    // Add debug-specific options
    if (settings.debug) {
      buildOptions.logLevel = "info";
      buildOptions.metafile = true;
    }

    console.log("🔨 Building with esbuild...");
    console.log(`   Target: ${buildOptions.target}`);
    console.log(`   Format: ${buildOptions.format}`);
    console.log(`   Output: ${outputFile}`);
    if (settings.debug) {
      console.log("   Source maps: enabled");
      console.log("   Minification: disabled");
    }

    await build({ ...buildOptions, plugins: [json5Plugin()] }).catch((err) => {
      console.error("❌ Build error:", err.message);
      process.exit(1);
    });

    if (!fs.existsSync(outputFile)) {
      console.error(`❌ Build output file not created: ${outputFile}`);
      process.exit(1);
    }

    console.log("✅ Build completed successfully");

    // Cleanup TypeScript files
    cleanupTypeScriptFiles();

    console.log("✨ Bundling complete!");
  } catch (error) {
    console.error("❌ Build failed:", error);
    process.exit(1);
  }
}

main();
