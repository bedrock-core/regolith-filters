import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { writeTestMetadata } from '../lib/test-metadata.ts';

it('fingerprints exact UI bytes deterministically and removes only its sidecar when disabled', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-testing-'));
  try {
    fs.mkdirSync(path.join(root, 'ui'));
    const bytes = '// generated\n{"namespace":"test"}\n';
    fs.writeFileSync(path.join(root, 'ui/screen.json'), bytes);
    const screens = [{ file: 'ui/screen.json', source: 'BP/scripts/home.screen.tsx', metadata: { screen: 'test:home' } }];
    writeTestMetadata(root, screens, true);
    const first = fs.readFileSync(path.join(root, 'bedrock-core/test-metadata.json'), 'utf8');
    expect(JSON.parse(first)).toMatchObject({ schemaVersion: 1, screens, files: [
      { path: 'ui/screen.json', sha256: createHash('sha256').update(bytes).digest('hex') },
    ] });
    writeTestMetadata(root, screens, true);
    expect(fs.readFileSync(path.join(root, 'bedrock-core/test-metadata.json'), 'utf8')).toBe(first);
    writeTestMetadata(root, [], false);
    expect(fs.existsSync(path.join(root, 'bedrock-core/test-metadata.json'))).toBe(false);
    expect(fs.readFileSync(path.join(root, 'ui/screen.json'), 'utf8')).toBe(bytes);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

it('removes stale metadata when no compiled screens remain, without requiring a UI directory', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-testing-'));
  try {
    fs.mkdirSync(path.join(root, 'bedrock-core'));
    fs.writeFileSync(path.join(root, 'bedrock-core/test-metadata.json'), '{"screens":["stale"]}');
    writeTestMetadata(root, [], true);
    expect(fs.existsSync(path.join(root, 'bedrock-core/test-metadata.json'))).toBe(false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
