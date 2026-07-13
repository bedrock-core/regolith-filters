// Inline (phrasing) content → an array of runs with Minecraft § style codes.
//
// Bedrock has no closing codes: §r clears EVERYTHING (color + bold + italic).
// So this is a state machine over a style stack — leaving a styled span emits
// §r followed by a re-emit of every still-active code. § sequences are
// zero-width in the ui-runtime text metrics, so none of this affects layout.
//
// Mapping: strong → §l, emphasis → §o, inlineCode → §7, delete (GFM) → §8,
// link → §9. Output is split into RUNS at internal-link boundaries (not a
// single collapsed string) so the caller can render an internal link as its
// own inline pressable element instead of decorative text plus a detached
// button row — external links stay plain text runs (nothing can open a
// browser from a server form).

import { toString as mdastToString } from 'mdast-util-to-string';

const STYLE = {
  strong: '§l',
  emphasis: '§o',
  inlineCode: '§7',
  delete: '§8',
  link: '§9',
};

/** true when the url points outside the guide (http, https, mailto, ...). */
export function isExternalUrl(url) {
  return /^[a-z][a-z0-9+.-]*:/i.test(url);
}

/**
 * Resolve an internal link url to a PageId within `pageIds`, or null.
 *
 * @param {string} url        e.g. './installation.mdx', '../intro', '/getting-started/intro#anchor'
 * @param {string} fromDir    directory of the linking page ('' for root), POSIX
 * @param {Set<string>} pageIds
 */
export function resolveInternalLink(url, fromDir, pageIds) {
  let target = url.split('#')[0].split('?')[0];
  if (!target) return null; // pure-anchor link — nothing to navigate to
  target = target.replace(/\.(mdx?|MDX?)$/, '');

  let joined;
  if (target.startsWith('/')) {
    joined = target.slice(1);
  } else {
    joined = fromDir ? `${fromDir}/${target}` : target;
  }

  // normalize ./ and ../ without touching the filesystem
  const parts = [];
  for (const part of joined.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (parts.length === 0) return null; // escapes the guide root
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  const pageId = parts.join('/');

  return pageIds.has(pageId) ? pageId : null;
}

/**
 * Compile mdast phrasing content to an array of §-styled runs, split at
 * internal-link boundaries.
 *
 * @param {Array} nodes  mdast phrasing children
 * @param {object} ctx
 * @param {(url: string) => string | null} ctx.resolveLink  internal url → PageId | null
 * @param {(id: string) => object | null} [ctx.getDefinition]  linkReference/imageReference lookup
 * @param {(msg: string) => void} ctx.warn
 * @param {(msg: string) => void} ctx.error
 * @returns {{ runs: Array<{ text: string, to?: string }> }}
 *   runs = the paragraph in document order; a run with `to` is an internal
 *   link rendered as its own pressable element, everything else is plain
 *   (styled) text. Adjacent plain runs are pre-merged.
 */
export function compileInline(nodes, ctx) {
  const runs = [];

  // One §-styled sub-walk over a style stack, isolated to its own buffer —
  // used both for the top-level walk and for a link's label (whose styling
  // must not leak `restore()` codes from the surrounding paragraph's stack).
  // `initialStyles` seeds already-active codes (e.g. a link label's own §9)
  // so nested strong/emphasis restores re-emit them correctly.
  const walk = (children, initialStyles = []) => {
    const styles = [...initialStyles];
    let out = initialStyles.join('');

    const restore = () => '§r' + styles.join('');

    // Escape .lang placeholder sequences (%1..%9, %s) so they render literally:
    // a zero-width reset+restore between '%' and the trigger char breaks the
    // sequence without affecting active styles or metrics.
    const emitText = (raw) => {
      const flat = raw.replace(/\s*\r?\n\s*/g, ' ');
      out += flat.replace(/%(?=[0-9s])/g, () => '%' + restore());
    };

    const push = (code) => {
      styles.push(code);
      out += code;
    };

    const pop = () => {
      styles.pop();
      out += restore();
    };

    const emitLink = (url, linkChildren) => {
      const asPlainStyledText = () => {
        push(STYLE.link);
        visitAll(linkChildren);
        pop();
      };

      if (isExternalUrl(url)) {
        asPlainStyledText(); // nothing can open a browser from a server form
        return;
      }

      const pageId = ctx.resolveLink(url);
      if (pageId === null) {
        if (!url.startsWith('#')) ctx.error(`broken internal link: "${url}"`);
        asPlainStyledText();
        return;
      }

      // Split the paragraph here: flush prose so far as its own run, then
      // the link becomes its own run (own §-styled sub-walk, so nested
      // strong/emphasis/inlineCode inside the label still work) so the
      // caller can render it as an inline pressable element, not decorative
      // text plus a detached button.
      if (out !== '') { runs.push({ text: out }); out = ''; }
      const styledLabel = walk(linkChildren, [STYLE.link]);
      const label = styledLabel !== STYLE.link
        ? styledLabel
        : `${STYLE.link}${mdastToString({ type: 'root', children: linkChildren }).trim() || pageId}`;
      runs.push({ text: label, to: pageId });
    };

    const visit = (node) => {
      switch (node.type) {
        case 'text':
          emitText(node.value);
          break;
        case 'strong':
        case 'emphasis':
        case 'delete':
          push(STYLE[node.type]);
          visitAll(node.children);
          pop();
          break;
        case 'inlineCode':
          push(STYLE.inlineCode);
          emitText(node.value);
          pop();
          break;
        case 'link':
          emitLink(node.url, node.children);
          break;
        case 'linkReference': {
          const def = ctx.getDefinition?.(node.identifier);
          if (def) emitLink(def.url, node.children);
          else {
            ctx.warn(`unresolved link reference "[${node.identifier}]"`);
            visitAll(node.children);
          }
          break;
        }
        case 'image':
          ctx.warn('inline images are not supported — alt text rendered instead');
          emitText(node.alt ?? '');
          break;
        case 'imageReference': {
          ctx.warn('inline images are not supported — alt text rendered instead');
          emitText(node.alt ?? '');
          break;
        }
        case 'break':
          out += ' '; // hard line breaks can't survive a .lang value (v1 limitation)
          break;
        case 'footnoteReference':
          ctx.warn('footnotes are not supported — skipped');
          break;
        case 'mdxJsxTextElement':
          ctx.warn(`inline JSX <${node.name ?? ''}> is not supported — children rendered as plain text`);
          visitAll(node.children);
          break;
        case 'mdxTextExpression':
          ctx.warn('inline JSX expressions are not supported — skipped');
          break;
        default:
          if (Array.isArray(node.children)) visitAll(node.children);
          else if (typeof node.value === 'string') emitText(node.value);
          else ctx.warn(`unsupported inline node "${node.type}" — skipped`);
      }
    };

    const visitAll = (items) => {
      for (const child of items) visit(child);
    };

    visitAll(children);
    return out;
  };

  const finalText = walk(nodes);
  if (finalText !== '') { runs.push({ text: finalText }); }

  return { runs };
}
