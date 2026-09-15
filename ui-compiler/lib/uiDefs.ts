// Registering emitted files in `_ui_defs.json`.
//
// Every UI file has to be listed there or the game never loads it. The filter
// does it rather than the author, because these are files nobody wrote and
// nobody can see until a build has run — asking someone to keep a list of them
// in step by hand is how a screen silently stops rendering.
//
// This edits the copy in the Regolith workspace, or writes one when the pack
// has none — an addon with no UI of its own before this build. The user's own
// `_ui_defs.json` is left exactly as they wrote it.

import fs from 'node:fs';
import path from 'node:path';

export interface UiDefsRegistration {
  /** Absolute path of `_ui_defs.json` in the workspace. */
  uiDefsFile: string;
  /** Absolute paths of the emitted UI files. */
  files: string[];
  /**
   * The indent to write a file from scratch with, and to comment the entries added to one that
   * exists. Absent, the file is written minified and the entries uncommented.
   */
  indent?: string;
}

/** @returns how many entries were added */
export function registerUiDefs({ uiDefsFile, files, indent }: UiDefsRegistration): number {
  const uiRoot = path.dirname(uiDefsFile);
  const entries = files.map(
    file => `ui/${path.relative(uiRoot, file).split(path.sep).join('/')}`,
  );

  if (!fs.existsSync(uiDefsFile)) {
    const document = { ui_defs: entries };

    fs.writeFileSync(
      uiDefsFile,
      indent === undefined ? JSON.stringify(document) : `${JSON.stringify(document, null, indent)}\n`,
      'utf-8',
    );

    return entries.length;
  }

  const raw = fs.readFileSync(uiDefsFile, 'utf-8');

  // A plain substring check: the file is JSONC, and reformatting someone's
  // comments and spacing to add one line would be a poor trade.
  const missing = entries.filter(entry => !raw.includes(`"${entry}"`));

  if (missing.length === 0) {
    return 0;
  }

  const inserted = indent === undefined
    ? missing.map(entry => `"${entry}",`).join('')
    : `\n${[`${indent}${indent}// Emitted by the ui-compiler filter.`, ...missing.map(entry => `${indent}${indent}"${entry}",`)].join('\n')}`;

  fs.writeFileSync(
    uiDefsFile,
    raw.replace(/("ui_defs"\s*:\s*\[)/, `$1${inserted}`),
    'utf-8',
  );

  return missing.length;
}
