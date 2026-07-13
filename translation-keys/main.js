// @bedrock-core/regolith-filters — translation-keys
// Generates data/translation-keys/translationKeys.generated.json: one JSON object
// nested by locale, each value a merged translation map for that locale.
//
// Per locale, merge order (later entries override earlier ones):
//   1. Vanilla <locale>.lang from Mojang's bedrock-samples GitHub (cached)
//   2. Pack RP/texts/<locale>.lang
//   3. Pack BP/texts/<locale>.lang
//
// Bedrock script bundles are static (no dynamic per-player import), so every
// configured locale's map ships in the one generated module — the addon
// script picks the right sub-map at runtime (e.g. via a player's preferred
// language) and passes it to TranslationKeysContext.

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

const VANILLA_LANG_URL_TEMPLATE =
    'https://raw.githubusercontent.com/Mojang/bedrock-samples/refs/heads/main/resource_pack/texts/{locale}.lang';

const defaults = {
    locales: ['en_US'],
    vanillaLangUrlTemplate: VANILLA_LANG_URL_TEMPLATE,
    cacheMaxAgeHours: 24,
    outputJsonPath: 'data/translation-keys/translationKeys.generated.json',
    langFilesTemplate: ['RP/texts/{locale}.lang', 'BP/texts/{locale}.lang'],
};

const argParsed = process.argv[2] ? JSON.parse(process.argv[2]) : {};
const settings = Object.assign({}, defaults, argParsed);

if (!Array.isArray(settings.locales) || settings.locales.length === 0) {
    console.error('❌ settings.locales must be a non-empty array of locale codes (e.g. ["en_US"])');
    process.exit(1);
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const cacheDir = path.join(projectRoot, '.regolith', 'cache', 'translation-keys');
const outputJsonPath = path.join(process.cwd(), settings.outputJsonPath);

/** @param {string} template @param {string} locale */
function fillLocale(template, locale) {
    return template.replaceAll('{locale}', locale);
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

console.log('🌐 @bedrock-core/translation-keys');
console.log('📂 Project root:', projectRoot);
console.log('📂 Working directory:', process.cwd());
console.log('🈯 Locales:', settings.locales.join(', '));

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
// Vanilla lang fetching (with cache, one file per locale)
// ---------------------------------------------------------------------------

/** @param {string} locale @returns {Promise<string>} raw .lang file content */
async function fetchVanillaLang(locale) {
    const url = fillLocale(settings.vanillaLangUrlTemplate, locale);
    const cacheFile = path.join(cacheDir, `vanilla-${locale}.lang.cache`);

    if (fs.existsSync(cacheFile)) {
        const stat = fs.statSync(cacheFile);
        const ageHours = (Date.now() - stat.mtimeMs) / (1000 * 60 * 60);

        if (ageHours < settings.cacheMaxAgeHours) {
            console.log(`✅ [${locale}] Using cached vanilla lang (age: ${ageHours.toFixed(1)}h)`);
            return fs.readFileSync(cacheFile, 'utf-8');
        }

        console.log(`⏳ [${locale}] Cache expired (${ageHours.toFixed(1)}h old), re-fetching...`);
    } else {
        console.log(`⏳ [${locale}] Fetching vanilla lang from ${url} ...`);
    }

    const res = await fetch(url);

    if (!res.ok) {
        throw new Error(`[${locale}] HTTP ${res.status} ${res.statusText} — ${url}`);
    }

    const text = await res.text();

    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(cacheFile, text, 'utf-8');
    console.log(`✅ [${locale}] Fetched and cached vanilla lang`);

    return text;
}

// ---------------------------------------------------------------------------
// Per-locale build
// ---------------------------------------------------------------------------

/** @param {string} locale @returns {Promise<Record<string, string>>} */
async function buildLocale(locale) {
    const vanillaContent = await fetchVanillaLang(locale);
    const merged = parseLang(vanillaContent);
    console.log(`ℹ️  [${locale}] Vanilla keys: ${Object.keys(merged).length}`);

    const langFiles = settings.langFilesTemplate.map((template) => fillLocale(template, locale));

    for (const relPath of langFiles) {
        const absPath = path.join(process.cwd(), relPath);

        if (!fs.existsSync(absPath)) {
            console.log(`ℹ️  [${locale}] ${relPath} not found — skipped`);
            continue;
        }

        const packEntries = parseLang(fs.readFileSync(absPath, 'utf-8'));
        const count = Object.keys(packEntries).length;

        for (const [k, v] of Object.entries(packEntries)) {
            merged[k] = v;
        }

        console.log(`✅ [${locale}] Merged ${relPath}: ${count} keys`);
    }

    console.log(`ℹ️  [${locale}] Total keys after merge: ${Object.keys(merged).length}`);

    // Sort alphabetically for determinism.
    return Object.fromEntries(Object.keys(merged).sort().map((k) => [k, merged[k]]));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
    /** @type {Record<string, Record<string, string>>} */
    const byLocale = {};

    for (const locale of settings.locales) {
        byLocale[locale] = await buildLocale(locale);
    }

    fs.mkdirSync(path.dirname(outputJsonPath), { recursive: true });
    fs.writeFileSync(outputJsonPath, JSON.stringify(byLocale, null, '\t'), 'utf-8');
    console.log(`✅ Written JSON map (${settings.locales.length} locale${settings.locales.length === 1 ? '' : 's'}) → ${outputJsonPath}`);
}

main().catch(err => {
    console.error('❌ translation-keys filter failed:', err instanceof Error ? err.message : String(err));
    process.exit(1);
});
