# Bundler

A Regolith filter for bundling TypeScript files into a single JavaScript file for Minecraft Bedrock Edition.

## Overview

This filter enables TypeScript development in Regolith projects by automatically bundling your TypeScript code from `packs/BP/scripts/` into a single `main.js` file that Minecraft can execute.

Built from [gametests](https://github.com/Bedrock-OSS/regolith-filters/tree/master/gametests) filter

## Differences from Gametests Filter

If you're coming from the [gametests](https://github.com/Bedrock-OSS/regolith-filters/tree/master/gametests) filter:

- ✅ **Simpler structure**: Uses `packs/BP/scripts/` instead of `data/gametests/` folder
- ✅ **Project root workflow**: Install dependencies and manage everything from your project root
- ✅ **Package manager agnostic**: Not hardcoded to npm - use any package manager
- ✅ **Focused scope**: Only handles bundling - you manage `tsconfig.json`, `launch.json`, and `manifest.json`

## Installation

Install the filter using Regolith:

```bash
regolith install github.com/bedrock-core/regolith-filters/bundler
```

Or use the provided starter in `starter-example`

## Requirements

1. **tsconfig.json** - Create a `tsconfig.json` in your project root
2. **package.json** - Set up your dependencies and TypeScript types
3. **packs/BP/scripts/** - Place your TypeScript files here

## Configuration

The filter accepts optional settings:

### Settings

- **`tsConfigPath`** _(string, default: `"tsconfig.json"`)_ - Path to your tsconfig.json file relative to the project root
- **`debug`** _(boolean, default: `false`)_ - Enable debug mode with source maps, no minification, and readable output

### Example with Custom Settings

```json
{
  "filter": "bundler",
  "settings": {
    "tsConfigPath": "tsconfig.build.json",
    "debug": true
  }
}
```

### Debug Mode

When `debug: true` is enabled:

- ✅ Source maps are generated (`BP/scripts/main.js.map`)
- ✅ No minification - readable output code
- ✅ Function names are preserved (`keepNames`)
- ✅ Verbose logging enabled
- ✅ Build metadata generated

## How It Works

1. **Regolith runs** the filter in a temp folder (`.regolith/tmp/<profile>/`)
2. **Filter reads** your `tsconfig.json` from the project root
3. **Entry points** are resolved from tsconfig patterns (or defaults to `BP/scripts/**/*.ts`)
4. **esbuild bundles** all TypeScript files into `BP/scripts/main.js`
5. **Cleanup** removes source `.ts` files from the output
6. **Done!** Your bundled JavaScript is ready in the temp folder

## Entry Point Resolution

The filter respects your `tsconfig.json` configuration:

- **If `files` is set** - Uses those specific files
- **If `include` is set** - Uses those glob patterns
- **Otherwise** - Defaults to all `.ts` files in `BP/scripts/`

The filter automatically adjusts paths to work within Regolith's temp folder structure.

## External Modules

The following Minecraft modules are automatically marked as external (not bundled):

- `@minecraft/server`
- `@minecraft/server-ui`
- `@minecraft/server-gametest`
- `@minecraft/server-net`
- `@minecraft/server-admin`
- `@minecraft/debug-utilities`

## Troubleshooting

### "tsconfig.json not found"

- Ensure `tsconfig.json` exists in your project root (same level as `config.json`)

### "No TypeScript files found"

- Check your tsconfig's `include` patterns
- Ensure TypeScript files exist in `BP/scripts/`
- Check `exclude` patterns aren't blocking your files

### "Build output file not created"

- Check for TypeScript compilation errors
- Ensure your entry points are valid
- Check esbuild output for specific errors

## Changelog

### 1.0.0

- Release
