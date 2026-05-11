// @bedrock-core/regolith-filters — item-aux
// Generates BP/scripts/data/itemAuxMap.generated.json with:
//   • Vanilla items: aux = raw_id * 65536  (source: Mojang bedrock-samples)
//   • Custom items:  aux = (customStart + alphabetical_index) * 65536
//                    (source: RP/textures/item_texture.json, non-minecraft: entries)

'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * @typedef {{
 *   command_name: string;
 *   name: string;
 *   raw_id: number;
 *   serialization_id: string;
 *   serialization_name: string;
 * }} VanillaDataItem
 *
 * @typedef {{
 *   data_items: VanillaDataItem[];
 *   module_type: string;
 *   name: string;
 *   vanilla_data_type: string;
 * }} MojangItemsResponse
 */

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

const ITEMS_URL =
    'https://raw.githubusercontent.com/Mojang/bedrock-samples/refs/heads/main/metadata/vanilladata_modules/mojang-items.json';

const defaults = {
    customStart: null,
    itemsUrl: ITEMS_URL,
    cacheMaxAgeHours: 24,
    outputPath: 'BP/scripts/data/itemAuxMap.generated.json',
};

const argParsed = process.argv[2] ? JSON.parse(process.argv[2]) : {};
const settings = Object.assign({}, defaults, argParsed);

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

// Cache lives in the Regolith project cache (.regolith/cache) so it persists
// across runs and is cleaned with `regolith clean`.
const cacheFile = path.join(projectRoot, '.regolith', 'cache', 'item-aux', 'vanilla-items.cache.json');

// item_texture.json is read from the Regolith temp folder (CWD).
const itemTexturePath = path.join(process.cwd(), 'RP', 'textures', 'item_texture.json');

// Output is written into the Regolith temp folder so Regolith exports it.
const outputPath = path.join(process.cwd(), settings.outputPath);

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

console.log('📦 @bedrock-core/item-aux');
console.log('📂 Project root:', projectRoot);
console.log('📂 Working directory:', process.cwd());

// ---------------------------------------------------------------------------
// Vanilla item fetching (with cache)
// ---------------------------------------------------------------------------

/** @returns {Promise<MojangItemsResponse>} */
async function fetchVanillaData() {
    if (fs.existsSync(cacheFile)) {
        const stat = fs.statSync(cacheFile);
        const ageHours = (Date.now() - stat.mtimeMs) / (1000 * 60 * 60);
        if (ageHours < settings.cacheMaxAgeHours) {
            console.log(`✅ Using cached vanilla items (age: ${ageHours.toFixed(1)}h)`);
            return JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
        }
        console.log(`⏳ Cache expired (${ageHours.toFixed(1)}h old), re-fetching...`);
    } else {
        console.log(`⏳ Fetching vanilla items from ${settings.itemsUrl} ...`);
    }

    const res = await fetch(settings.itemsUrl);
    if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText} — ${settings.itemsUrl}`);
    }
    const json = await res.json();

    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify(json, null, '\t'), 'utf-8');
    console.log(`✅ Fetched and cached ${json.data_items?.length ?? 0} vanilla items`);

    return json;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
    // ── Vanilla items ─────────────────────────────────────────────────────────
    const vanillaData = await fetchVanillaData();
    const dataItems = vanillaData.data_items;

    if (!Array.isArray(dataItems)) {
        throw new Error('Unexpected JSON shape: expected a .data_items array');
    }

    /** @type {Array<[string, number]>} */
    const validItems = dataItems.filter(
        item => typeof item.name === 'string' && typeof item.raw_id === 'number',
    );

    /** @type {Array<[string, number]>} */
    const vanillaEntries = validItems.map(item => [item.name, item.raw_id * 65536]);

    // Resolve customStart: use explicit setting or derive from max vanilla raw_id.
    const maxVanillaId = validItems.reduce((max, item) => Math.max(max, item.raw_id), 0);
    const customStart =
        settings.customStart != null ? settings.customStart : maxVanillaId + 1;
    console.log(`ℹ️  Custom item start ID: ${customStart} (max vanilla raw_id: ${maxVanillaId})`);

    // ── Custom items from item_texture.json ───────────────────────────────────
    /** @type {Array<[string, number]>} */
    const customEntries = [];

    if (fs.existsSync(itemTexturePath)) {
        const textureJson = JSON.parse(fs.readFileSync(itemTexturePath, 'utf-8'));
        const textureData = textureJson?.texture_data;

        if (textureData && typeof textureData === 'object') {
            // Only non-vanilla namespaced identifiers (e.g. "myaddon:cool_sword").
            // Vanilla items appear with bare short-names ("diamond_sword") or
            // "minecraft:" prefix in the texture atlas — both are excluded.
            const customIds = Object.keys(textureData)
                .filter(k => k.includes(':') && !k.startsWith('minecraft:'))
                .sort(); // alphabetical sort is mandatory for deterministic ID assignment

            for (let i = 0; i < customIds.length; i++) {
                customEntries.push([customIds[i], (customStart + i) * 65536]);
            }

            const vanillaInTexture = Object.keys(textureData).length - customIds.length;
            console.log(
                `✅ item_texture.json: ${Object.keys(textureData).length} entries` +
                ` (${vanillaInTexture} vanilla-atlas skipped, ${customIds.length} custom)`,
            );
        }
    } else {
        console.log('ℹ️  RP/textures/item_texture.json not found — no custom items added');
    }

    // ── Merge & write ─────────────────────────────────────────────────────────
    /** @type {Record<string, number>} */
    const map = {};
    for (const [name, aux] of vanillaEntries) map[name] = aux;
    for (const [name, aux] of customEntries) map[name] = aux;

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(map, null, '\t'), 'utf-8');

    console.log(
        `✅ Written ${vanillaEntries.length} vanilla + ${customEntries.length} custom` +
        ` = ${Object.keys(map).length} total → ${outputPath}`,
    );
}

main().catch(err => {
    console.error('❌ item-aux filter failed:', err instanceof Error ? err.message : String(err));
    process.exit(1);
});
