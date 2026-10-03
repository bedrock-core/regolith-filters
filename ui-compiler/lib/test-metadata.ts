import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export interface TestMetadataScreen {
  file: string;
  source: string;
  metadata: unknown;
}

/** Development-only sidecar tied to the exact generated UI bytes. */
export function writeTestMetadata(resourcePack: string, screens: TestMetadataScreen[], enabled: boolean): void {
  const output = path.join(resourcePack, 'bedrock-core/test-metadata.json');

  if (!enabled || screens.length === 0) {
    fs.rmSync(output, { force: true });
    return;
  }

  const files: Array<{ path: string; sha256: string }> = [];
  const walk = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);

      if (entry.isSymbolicLink()) throw new Error('Test metadata cannot fingerprint linked UI files.');
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile() && entry.name.endsWith('.json')) files.push({
        path: path.relative(resourcePack, file).split(path.sep).join('/'),
        sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
      });
    }
  };

  walk(path.join(resourcePack, 'ui'));
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  screens = [...screens].sort((a, b) => a.file < b.file ? -1 : a.file > b.file ? 1 : 0);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify({ schemaVersion: 1, producer: '@bedrock-core/ui-compiler', files, screens }, null, 2) + '\n');
}
