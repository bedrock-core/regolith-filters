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

/**
 * @param {object} options
 * @param {string} options.uiDefsFile absolute path of `_ui_defs.json` in the workspace
 * @param {string[]} options.files    absolute paths of the emitted UI files
 * @returns {number} how many entries were added
 */
export function registerUiDefs({ uiDefsFile, files }) {
  const uiRoot = path.dirname(uiDefsFile);
  const entries = files.map(
    file => `ui/${path.relative(uiRoot, file).split(path.sep).join('/')}`,
  );

  if (!fs.existsSync(uiDefsFile)) {
    fs.writeFileSync(uiDefsFile, `${JSON.stringify({ ui_defs: entries }, null, '\t')}\n`, 'utf-8');

    return entries.length;
  }

  const raw = fs.readFileSync(uiDefsFile, 'utf-8');

  // A plain substring check: the file is JSONC, and reformatting someone's
  // comments and spacing to add one line would be a poor trade.
  const missing = entries.filter(entry => !raw.includes(`"${entry}"`));

  if (missing.length === 0) {
    return 0;
  }

  const lines = ['\t\t// Emitted by the ui-compile filter.']
    .concat(missing.map(entry => `\t\t"${entry}",`))
    .join('\n');

  fs.writeFileSync(
    uiDefsFile,
    raw.replace(/("ui_defs"\s*:\s*\[)/, `$1\n${lines}`),
    'utf-8',
  );

  return missing.length;
}
