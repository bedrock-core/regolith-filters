// Inline (phrasing) content → one string with Minecraft § style codes, and where its links sit.
//
// Bedrock has no closing codes: §r clears EVERYTHING (color + bold + italic).
// So this is a state machine over a style stack — leaving a styled span emits
// §r followed by a re-emit of every still-active code. § sequences are
// zero-width in the ui-runtime text metrics, so none of this affects layout.
//
// Mapping: strong → §l, emphasis → §o, inlineCode → §7, delete (GFM) → §8,
// link → §9, and a link nothing can open (the web, an anchor) → §3. A paragraph
// is ONE string per language, and each internal link is the span of it the link
// covers: the ui-compiler breaks the paragraph into lines per language and makes
// those spans pressable where they are drawn.

import { toString as mdastToString } from 'mdast-util-to-string';

// The mdast tree is walked structurally; pinning it to a node union would have
// to be re-pinned on every remark upgrade, so nodes stay open here.
type MdastNode = any;

/** An internal link, as the span `[start, end)` of the paragraph's text its label covers. */
export interface InlineLink {
  to: string;
  at: [number, number];
}

/** A paragraph's inline content: one §-styled string, and the spans its internal links cover. */
export interface InlineText {
  text: string;
  links: InlineLink[];
}

export interface InlineContext {
  resolveLink: (url: string) => string | null;
  getDefinition?: (id: string) => any;
  warn: (msg: string) => void;
  error: (msg: string) => void;
}

const STYLE = {
  strong: '§l',
  emphasis: '§o',
  inlineCode: '§7',
  delete: '§8',
  link: '§9',
  /** A link nothing can open — the web, or an anchor on the same page: a dimmer blue than one that works. */
  unopenable: '§3',
};

/** true when the url points outside the guide (http, https, mailto, ...). */
export function isExternalUrl(url: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(url);
}

/**
 * Resolve an internal link url to a PageId within `pageIds`, or null.
 *
 * `url` is e.g. './installation.mdx', '../intro', '/getting-started/intro#anchor';
 * `fromDir` is the linking page's directory ('' for root), POSIX-separated.
 */
export function resolveInternalLink(url: string, fromDir: string, pageIds: Set<string>): string | null {
  let target = url.split('#')[0]!.split('?')[0]!;
  if (!target) return null; // pure-anchor link — nothing to navigate to
  target = target.replace(/\.(mdx?|MDX?)$/, '');

  let joined: string;
  if (target.startsWith('/')) {
    joined = target.slice(1);
  } else {
    joined = fromDir ? `${fromDir}/${target}` : target;
  }

  // normalize ./ and ../ without touching the filesystem
  const parts: string[] = [];
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

/** Whether a stretch of styled text draws anything: § codes are zero-width. */
const visible = (text: string): boolean => text.replace(/§./g, '') !== '';

/**
 * Compile mdast phrasing content to one §-styled string, and the span of it
 * each internal link covers.
 */
export function compileInline(nodes: MdastNode[], ctx: InlineContext): InlineText {
  const links: InlineLink[] = [];

  // One §-styled walk over a style stack.
  const walk = (children: MdastNode[]): string => {
    const styles: string[] = [];
    let out = '';

    const restore = () => '§r' + styles.join('');

    // Escape .lang placeholder sequences (%1..%9, %s), and anything a <Trans>
    // would read as a tag, so they render literally: a zero-width reset+restore
    // after the '%' or the '<' breaks the sequence without affecting active
    // styles or metrics.
    const emitText = (raw: string): void => {
      const flat = raw.replace(/\s*\r?\n\s*/g, ' ');
      out += flat.replace(/%(?=[0-9s])|<(?=\/?[A-Za-z0-9_])/g, found => found + restore());
    };

    const push = (code: string): void => {
      styles.push(code);
      out += code;
    };

    const pop = () => {
      styles.pop();
      out += restore();
    };

    const emitLink = (url: string, linkChildren: MdastNode[]): void => {
      const asPlainStyledText = () => {
        push(STYLE.unopenable);
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

      // The label stays in the paragraph's string, in the link colour, and its
      // span is what gets pressed. A label that draws nothing reads as the page
      // it opens.
      push(STYLE.link);
      const start = out.length;
      visitAll(linkChildren);
      if (!visible(out.slice(start))) emitText(mdastToString({ type: 'root', children: linkChildren }).trim() || pageId);
      links.push({ to: pageId, at: [start, out.length] });
      pop();
    };

    const visit = (node: MdastNode): void => {
      switch (node.type) {
        case 'text':
          emitText(node.value);
          break;
        case 'strong':
        case 'emphasis':
        case 'delete':
          push(STYLE[node.type as keyof typeof STYLE]);
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

    const visitAll = (items: MdastNode[]): void => {
      for (const child of items) visit(child);
    };

    visitAll(children);
    return out;
  };

  return { text: walk(nodes), links };
}
