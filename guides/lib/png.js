// PNG IHDR dimension sniff — width/height live at fixed offsets right after
// the 8-byte signature + 8-byte chunk header. No dependency needed.

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * @param {Buffer} buffer
 * @returns {{ w: number, h: number } | undefined}
 */
export function readPngSize(buffer) {
  if (buffer.length < 24) return undefined;
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return undefined;
  if (buffer.toString('ascii', 12, 16) !== 'IHDR') return undefined;
  const w = buffer.readUInt32BE(16);
  const h = buffer.readUInt32BE(20);
  if (w === 0 || h === 0) return undefined;
  return { w, h };
}
