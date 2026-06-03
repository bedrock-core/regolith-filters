// @bedrock-core/regolith-filters — item-aux
// Generates data/item-aux/itemAuxMap.generated.json with aux IDs for all items.
//
// Encoding (post-1.16.100 new-format custom items):
//   • Vanilla blocks/items (raw_id < 256):   aux = raw_id * 65536
//   • Vanilla items (raw_id >= 256):          aux = (raw_id + customItemCount) * 65536
//   • Custom items (new format, 1.16.100+):   aux = (257 + i) * 65536
//   • Custom blocks (terrain_texture.json, rev-alpha): aux = -(|minVanillaId| + blockBaseOffset + i) * 65536
//
// New-format custom items occupy IDs 257 … 256+customItemCount, pushing all
// vanilla items that were ≥ 256 upward by customItemCount. This matches the
// post-1.16.100 Bedrock runtime behaviour documented at:
// https://wiki.bedrock.dev/items/numerical-item-ids
//
// Custom item identifiers come from RP/textures/item_texture.json (non-minecraft: keys).
// Custom block identifiers come from RP/textures/terrain_texture.json (non-minecraft: keys, reverse-alpha sort).

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
    itemsUrl: ITEMS_URL,
    cacheMaxAgeHours: 24,
    outputPath: 'data/item-aux/itemAuxMap.generated.json',
    blockBaseOffset: 8621,
    // Vanilla items with raw_id >= shiftThreshold may have their actual game
    // raw_id displaced by developer-only items that aren't in the public API.
    // The companion itemMetadata.generated.json lists these items so the addon
    // script can detect and correct the offset at runtime via ItemTypes.getAll().
    // 632 is the empirically-confirmed first raw_id that differs between the
    // public bedrock-samples and developer Bedrock builds.
    shiftThreshold: 632,
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

    /** @type {Array<{name: string, raw_id: number}>} */
    const validItems = dataItems.filter(
        item => typeof item.name === 'string' && typeof item.raw_id === 'number',
    );

    const maxVanillaId = validItems.reduce((max, item) => Math.max(max, item.raw_id), 0);
    const minVanillaId = validItems.reduce((min, item) => Math.min(min, item.raw_id), 0);
    console.log(`ℹ️  Vanilla raw_id range: ${minVanillaId} … ${maxVanillaId}`);

    // ── Count custom items first so the offset can be applied to vanilla ─────
    /** @type {string[]} */
    let customIds = [];

    if (fs.existsSync(itemTexturePath)) {
        const textureJson = JSON.parse(fs.readFileSync(itemTexturePath, 'utf-8'));
        const textureData = textureJson?.texture_data;

        if (textureData && typeof textureData === 'object') {
            // Only non-vanilla namespaced identifiers (e.g. "myaddon:cool_sword").
            // Vanilla items appear with bare short-names ("diamond_sword") or
            // "minecraft:" prefix in the texture atlas — both are excluded.
            customIds = Object.keys(textureData)
                .filter(k => k.includes(':') && !k.startsWith('minecraft:'))
                .sort(); // alphabetical sort is mandatory for deterministic ID assignment

            const vanillaInTexture = Object.keys(textureData).length - customIds.length;
            console.log(
                `✅ item_texture.json: ${Object.keys(textureData).length} entries` +
                ` (${vanillaInTexture} vanilla-atlas skipped, ${customIds.length} custom)`,
            );
        }
    } else {
        console.log('ℹ️  RP/textures/item_texture.json not found — no custom items added');
    }

    const customItemCount = customIds.length;
    console.log(`ℹ️  Custom item count (offset applied to vanilla raw_id >= 256): ${customItemCount}`);

    // ── Vanilla entries ──────────────────────────
    // For id >= 256, the post-1.16.100 reshuffle shifts vanilla IDs by the
    // custom item count to make room for addon items. Blocks (id < 256, plus
    // negative IDs for new blocks) pass through unchanged.
    /** @type {Array<[string, number]>} */
    const vanillaEntries = validItems.map(item => {
        const id = item.raw_id;
        const offset = id >= 256 ? customItemCount : 0;
        return [item.name, (id + offset) * 65536];
    });

    // ── Custom entries: IDs 257 … 256+customItemCount ─────────────────────────
    // New-format custom items (1.16.100+) occupy the ID range starting at 257,
    // which is why vanilla items with raw_id >= 256 are shifted up by customItemCount.
    /** @type {Array<[string, number]>} */
    const customEntries = customIds.map((name, i) => [name, (257 + i) * 65536]);

    // ── Custom blocks: IDs -(customBlockBase+i) ───────────────────────────────
    // The base is derived from the minimum vanilla raw_id: each new vanilla block
    // decrements minVanillaId by 1 and increments the base by 1, so:
    //   base = |minVanillaId| + blockBaseOffset   (auto-tracks Bedrock updates)
    // Ordering: alphabetical sort on terrain_texture.json non-minecraft: keys.
    const customBlockBase = Math.abs(minVanillaId) + settings.blockBaseOffset;
    console.log(`ℹ️  customBlockBase = |${minVanillaId}| + ${settings.blockBaseOffset} = ${customBlockBase}`);

    /** @type {Array<[string, number]>} */
    let customBlockEntries = [];

    const terrainTexturePath = path.join(process.cwd(), 'RP', 'textures', 'terrain_texture.json');

    if (fs.existsSync(terrainTexturePath)) {
        const terrainJson = JSON.parse(fs.readFileSync(terrainTexturePath, 'utf-8'));
        const terrainData = terrainJson?.texture_data;

        if (terrainData && typeof terrainData === 'object') {
            const customBlockIds = Object.keys(terrainData)
                .filter(k => k.includes(':') && !k.startsWith('minecraft:'))
                .sort((a, b) => b.localeCompare(a)); // reverse alpha — matches Bedrock's ID assignment order

            console.log(`✅ terrain_texture.json: ${customBlockIds.length} custom blocks → [${customBlockIds.join(', ')}]`);
            customBlockEntries = customBlockIds.map((name, i) => [name, -(customBlockBase + i) * 65536]);
        }
    } else {
        console.log('ℹ️  terrain_texture.json not found — no custom blocks added');
    }

    // ── Merge & write ─────────────────────────────────────────────────────────
    /** @type {Record<string, number>} */
    const items = {};
    for (const [name, aux] of vanillaEntries) items[name] = aux;
    for (const [name, aux] of customEntries) items[name] = aux;
    for (const [name, aux] of customBlockEntries) items[name] = aux;

    // correctionBoundaryAux is the lowest aux value that belongs to a vanilla
    // item that may be displaced by developer-build items absent from the public
    // API. At runtime the script adds extraDevCount * 65536 to every entry
    // whose aux >= this boundary.
    //
    // Formula: (shiftThreshold + customItemCount) * 65536
    //   shiftThreshold = first raw_id affected by dev-build displacement (632)
    //   customItemCount = number of custom items in this pack (shifts the range)
    //
    // Items below the boundary (old-format blocks/items, custom items) always
    // have aux well under this value and are never corrected.
    const correctionBoundaryAux = (settings.shiftThreshold + customItemCount) * 65536;

    const output = { items, correctionBoundaryAux };

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(output, null, '\t'), 'utf-8');

    console.log(
        `✅ Written ${vanillaEntries.length} vanilla + ${customEntries.length} custom items` +
        ` + ${customBlockEntries.length} custom blocks` +
        ` = ${Object.keys(items).length} total, correctionBoundaryAux=${correctionBoundaryAux}` +
        ` → ${outputPath}`,
    );

}

main().catch(err => {
    console.error('❌ item-aux filter failed:', err instanceof Error ? err.message : String(err));
    process.exit(1);
});
