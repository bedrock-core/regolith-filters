// Minimal .tgz reader. npm tarballs are ustar archives of a single `package/`
// directory, so a full tar implementation would be dead weight — this handles
// the header fields npm actually emits (plus GNU long names and pax headers,
// which show up occasionally on deeply nested paths).

const zlib = require("zlib");

const BLOCK = 512;

function readString(buf, offset, length) {
  const end = buf.indexOf(0, offset);
  const stop = end === -1 || end > offset + length ? offset + length : end;
  return buf.toString("utf8", offset, stop);
}

function readOctal(buf, offset, length) {
  const raw = readString(buf, offset, length).trim();
  if (!raw) return 0;
  return parseInt(raw, 8) || 0;
}

/**
 * Extract a gzipped tar buffer into a flat map of entry path -> file contents.
 * Directories, symlinks and metadata entries are skipped; only regular files
 * come back.
 *
 * @param {Buffer} tgz
 * @returns {Map<string, Buffer>} entry path (as stored, e.g. `package/foo.json`) -> contents
 */
function extractTgz(tgz) {
  const tar = zlib.gunzipSync(tgz);
  const files = new Map();

  let offset = 0;
  let longName = null;

  while (offset + BLOCK <= tar.length) {
    const header = tar.subarray(offset, offset + BLOCK);

    // Two consecutive zero blocks terminate the archive.
    if (header.every((b) => b === 0)) break;

    const size = readOctal(header, 124, 12);
    const typeFlag = String.fromCharCode(header[156]) || "0";
    const dataStart = offset + BLOCK;
    const dataEnd = dataStart + size;

    let name = longName ?? readString(header, 0, 100);
    longName = null;

    const prefix = readString(header, 345, 155);
    if (prefix && !name.startsWith(prefix)) name = `${prefix}/${name}`;

    if (typeFlag === "L") {
      // GNU long name: this entry's body is the real name of the next entry.
      longName = tar.toString("utf8", dataStart, dataEnd).replace(/\0+$/, "");
    } else if (typeFlag === "0" || typeFlag === "\0" || typeFlag === "") {
      files.set(name.replace(/\\/g, "/"), tar.subarray(dataStart, dataEnd));
    }
    // '5' (dir), '1'/'2' (links), 'x'/'g' (pax) are all skipped.

    offset = dataStart + Math.ceil(size / BLOCK) * BLOCK;
  }

  return files;
}

module.exports = { extractTgz };
