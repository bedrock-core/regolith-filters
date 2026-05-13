// @bedrock-core/regolith-filters — translation-keys
// Generates BP/scripts/data/translationKeys.generated.json with merged translations.
//
// Merge order (later entries override earlier ones):
//   1. Vanilla en_US.lang from Mojang's bedrock-samples GitHub (cached)
//   2. Pack RP/texts/en_US.lang
//   3. Pack BP/texts/en_US.lang
//
// Also writes the merged RP/texts/en_US.lang so the delivered RP contains all keys.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const projectRoot = process.env['ROOT_DIR'];
if (!projectRoot) {
    console.error('❌ ROOT_DIR environment variable not set');
    console.error('This filter must be run by Regolith');
    process.exit(1);
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

const VANILLA_LANG_URL =
    'https://raw.githubusercontent.com/Mojang/bedrock-samples/refs/heads/main/resource_pack/texts/en_US.lang';

const defaults = {
    vanillaLangUrl: VANILLA_LANG_URL,
    cacheMaxAgeHours: 24,
    outputJsonPath: 'BP/scripts/data/translationKeys.generated.json',
    langFiles: ['RP/texts/en_US.lang', 'BP/texts/en_US.lang'],
};

const argParsed = process.argv[2] ? JSON.parse(process.argv[2]) : {};
const settings = Object.assign({}, defaults, argParsed);

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const cacheFile = path.join(projectRoot, '.regolith', 'cache', 'translation-keys', 'vanilla-en_US.lang.cache');
const outputJsonPath = path.join(process.cwd(), settings.outputJsonPath);

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

console.log('🌐 @bedrock-core/translation-keys');
console.log('📂 Project root:', projectRoot);
console.log('📂 Working directory:', process.cwd());

// ---------------------------------------------------------------------------
// .lang file parsing
// ---------------------------------------------------------------------------

/**
 * Parse a Minecraft .lang file into a key→value map.
 * Lines starting with # are comments; blank lines are skipped.
 * Format: key=value (value may contain '=').
 *
 * @param {string} content
 * @returns {Record<string, string>}
 */
function parseLang(content) {
    /** @type {Record<string, string>} */
    const map = {};

    for (const rawLine of content.split('\n')) {
        const line = rawLine.trimEnd();

        if (!line || line.startsWith('#')) continue;

        const eqIdx = line.indexOf('=');
        if (eqIdx === -1) continue;

        const key = line.slice(0, eqIdx).trim();
        const value = line.slice(eqIdx + 1); // preserve leading spaces in value

        if (key) {
            map[key] = value;
        }
    }

    return map;
}

// ---------------------------------------------------------------------------
// Vanilla lang fetching (with cache)
// ---------------------------------------------------------------------------

/** @returns {Promise<string>} raw .lang file content */
async function fetchVanillaLang() {
    if (fs.existsSync(cacheFile)) {
        const stat = fs.statSync(cacheFile);
        const ageHours = (Date.now() - stat.mtimeMs) / (1000 * 60 * 60);

        if (ageHours < settings.cacheMaxAgeHours) {
            console.log(`✅ Using cached vanilla en_US.lang (age: ${ageHours.toFixed(1)}h)`);
            return fs.readFileSync(cacheFile, 'utf-8');
        }

        console.log(`⏳ Cache expired (${ageHours.toFixed(1)}h old), re-fetching...`);
    } else {
        console.log(`⏳ Fetching vanilla en_US.lang from ${settings.vanillaLangUrl} ...`);
    }

    const res = await fetch(settings.vanillaLangUrl);

    if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText} — ${settings.vanillaLangUrl}`);
    }

    const text = await res.text();

    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(cacheFile, text, 'utf-8');
    console.log(`✅ Fetched and cached vanilla en_US.lang`);

    return text;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
    // ── Vanilla translations ──────────────────────────────────────────────────
    const vanillaContent = await fetchVanillaLang();
    const merged = parseLang(vanillaContent);
    console.log(`ℹ️  Vanilla keys: ${Object.keys(merged).length}`);

    // ── Pack translations (merge in order) ────────────────────────────────────
    for (const relPath of settings.langFiles) {
        const absPath = path.join(process.cwd(), relPath);

        if (!fs.existsSync(absPath)) {
            console.log(`ℹ️  ${relPath} not found — skipped`);
            continue;
        }

        const packEntries = parseLang(fs.readFileSync(absPath, 'utf-8'));
        const count = Object.keys(packEntries).length;

        for (const [k, v] of Object.entries(packEntries)) {
            merged[k] = v;
        }

        console.log(`✅ Merged ${relPath}: ${count} keys`);
    }

    const totalKeys = Object.keys(merged).length;
    console.log(`ℹ️  Total keys after merge: ${totalKeys}`);

    // ── Write JSON output ─────────────────────────────────────────────────────
    // Sort alphabetically for determinism.
    const sortedJson = Object.fromEntries(
        Object.keys(merged).sort().map(k => [k, merged[k]]),
    );

    fs.mkdirSync(path.dirname(outputJsonPath), { recursive: true });
    fs.writeFileSync(outputJsonPath, JSON.stringify(sortedJson, null, '\t'), 'utf-8');
    console.log(`✅ Written JSON map (${totalKeys} keys) → ${outputJsonPath}`);
}

main().catch(err => {
    console.error('❌ translation-keys filter failed:', err instanceof Error ? err.message : String(err));
    process.exit(1);
});
