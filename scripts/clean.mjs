/**
 * Removes what an install or a build regenerates in this repository: the dependency trees of the
 * root and of every filter.
 *
 *   yarn clean
 *
 * There is no build step: Node runs the filters from TypeScript source, so nothing else here
 * is generated.
 *
 * Sources, configuration and anything git tracks are never touched.
 */
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Directory names a tool here rewrites from scratch, wherever they appear. */
const DISPOSABLE = new Set(['node_modules']);

/** Never descended into: it holds the repository itself, not anything regenerable. */
const SKIP = new Set(['.git']);

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

let removed = 0;

function drop(target) {
  rmSync(target, { recursive: true, force: true });
  console.log(`removed ${relative(root, target)}`);
  removed++;
}

/** Depth-first, and a disposable directory is dropped whole rather than walked into. */
function sweep(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const target = join(dir, entry.name);

    if (entry.isDirectory()) {
      if (SKIP.has(entry.name)) continue;

      if (DISPOSABLE.has(entry.name)) { drop(target); continue; }

      sweep(target);
      continue;
    }
  }
}

sweep(root);

console.log(removed === 0 ? 'nothing to remove' : `${removed} ${removed === 1 ? 'path' : 'paths'} removed`);
