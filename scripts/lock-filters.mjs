#!/usr/bin/env node
/**
 * Refreshes every filter's own `package-lock.json`, then the root one.
 *
 * Regolith installs a filter by running `npm i` inside that filter's folder, so
 * the lockfile a project gets is the one committed beside the filter. Inside this
 * repository's workspaces a plain `npm install` in a filter folder writes the ROOT
 * lockfile instead, so each filter is locked with workspaces turned off. The root
 * lockfile is refreshed last: it records every filter's version, which
 * `changeset version` has just changed.
 *
 * Lockfiles only: nothing is installed into node_modules.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { workspaces } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));

// npm is a .cmd shim on Windows, which Node only spawns through a shell.
const npm = (cwd, extra) => execFileSync(
  'npm',
  ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund', ...extra],
  { cwd, stdio: 'inherit', shell: process.platform === 'win32' },
);

for (const filter of workspaces) {
  console.log(`lock: ${filter}`);
  npm(path.join(root, filter), ['--workspaces=false']);
}

console.log('lock: root');
npm(root, []);
