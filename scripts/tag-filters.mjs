#!/usr/bin/env node
/**
 * Tags every filter whose current version has no tag yet, as `<filter>-<version>`.
 *
 * That is the tag Regolith checks out: a project's `filterDefinitions` entry names
 * this repository and a version, and `<filter>` is the folder the filter lives in,
 * which is also its key in `resolver.json`. Changesets' own tags (`name@version`)
 * cannot be read that way, so this takes the place of `changeset tag`.
 *
 * It refuses while changesets are pending, never moves an existing tag, pushes
 * every new tag in one push, and cuts a GitHub release per tag from that version's
 * CHANGELOG section when `gh` is authenticated through GH_TOKEN.
 *
 *   node scripts/tag-filters.mjs            tag, push, release
 *   node scripts/tag-filters.mjs --dry-run  print what it would do, change nothing
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DOCS = 'https://bedrock-core.drav.dev/docs/filters';

const dryRun = process.argv.includes('--dry-run');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (file) => JSON.parse(readFileSync(path.join(root, file), 'utf8'));
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

const fail = (message) => {
  console.error(`tag-filters: ${message}`);
  process.exit(1);
};

// A tag cut while changesets are pending would release a version the Version PR is about to change.
const pending = readdirSync(path.join(root, '.changeset'))
  .filter(name => name.endsWith('.md') && name !== 'README.md');

if (pending.length > 0) {
  fail(`changesets are pending; merge the Version PR first:\n  ${pending.join('\n  ')}`);
}

const { workspaces } = readJson('package.json');
const resolvable = new Set(Object.keys(readJson('resolver.json').filters));

// Remote tags count too, so a clone that never fetched cannot tag a version twice.
try {
  git('fetch', '--tags', '--quiet', 'origin');
} catch {
  console.warn('tag-filters: could not fetch tags from origin; checking the local ones only');
}

const existing = new Set(git('tag', '--list').split('\n').filter(Boolean));
const created = [];

for (const filter of workspaces) {
  if (!existsSync(path.join(root, filter, 'filter.json'))) {
    fail(`${filter} is a workspace without a filter.json`);
  }

  if (!resolvable.has(filter)) {
    fail(`${filter} is missing from resolver.json, so Regolith cannot install it by name`);
  }

  const { version } = readJson(path.join(filter, 'package.json'));
  const tag = `${filter}-${version}`;

  if (existing.has(tag)) {
    console.log(`  ${tag} exists`);
    continue;
  }

  console.log(`+ ${tag}`);
  created.push({ filter, version, tag });

  if (!dryRun) {
    git('tag', '--annotate', tag, '--message', `${filter} ${version}`);
  }
}

if (created.length === 0) {
  console.log('tag-filters: every filter version is already tagged');
  process.exit(0);
}

if (dryRun) {
  console.log(`tag-filters: dry run, ${created.length} tag(s) not created`);
  process.exit(0);
}

git('push', 'origin', ...created.map(({ tag }) => `refs/tags/${tag}`));
console.log(`tag-filters: pushed ${created.length} tag(s)`);

/** The body of `## <version>` in a filter's changelog, or undefined when it has none. */
const changelogSection = (filter, version) => {
  const file = path.join(root, filter, 'CHANGELOG.md');

  if (!existsSync(file)) {
    return undefined;
  }

  const text = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const heading = `\n## ${version}\n`;
  const start = text.indexOf(heading);

  if (start === -1) {
    return undefined;
  }

  const body = text.slice(start + heading.length);
  const end = body.search(/\n## /);

  return (end === -1 ? body : body.slice(0, end)).trim();
};

if (!process.env.GH_TOKEN) {
  console.log('tag-filters: GH_TOKEN is not set; tags pushed without GitHub releases');
  process.exit(0);
}

const notesDir = mkdtempSync(path.join(os.tmpdir(), 'filter-release-'));

for (const { filter, version, tag } of created) {
  const notes = changelogSection(filter, version) ?? `Documentation: ${DOCS}/${filter}`;
  const notesFile = path.join(notesDir, `${tag}.md`);

  writeFileSync(notesFile, `${notes}\n`);

  // Several filters release together, so none of them is marked as the repository's latest.
  execFileSync('gh', [
    'release', 'create', tag,
    '--title', `${filter} ${version}`,
    '--notes-file', notesFile,
    '--verify-tag',
    '--latest=false',
  ], { cwd: root, stdio: 'inherit' });
}

console.log(`tag-filters: ${created.length} GitHub release(s) created`);
