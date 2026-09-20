// mdast block nodes → guide IR blocks + generated .lang entries.
//
// Key indices (b<N>, i<M>, k<M>) count *emitted* nodes in document order and
// nothing else — the same walk runs for every locale, so identical structure
// yields identical keys (see lib/keys.js).

import { type InlineText, compileInline } from './inline.ts';

/** :::kind — Docusaurus admonition kinds ('caution' is a legacy warning alias). */
const ADMONITION_KINDS = {
  note: 'note',
  tip: 'tip',
  info: 'info',
  warning: 'warning',
  danger: 'danger',
  caution: 'warning',
};

// Admonition titles render through localizationKey, and a key can't carry a §
// prefix — so the kind color+bold is baked into the title VALUE instead.
export const ADMONITION_COLORS = {
  note: '§7',
  tip: '§a',
  info: '§b',
  warning: '§6',
  danger: '§c',
};

type MdastNode = any;

const utf8Bytes = (s: string): number => Buffer.byteLength(s, 'utf8');

export interface CompilePageContext {
  /** parsed frontmatter (may be {}) */
  frontmatter: Record<string, any>;
  /** nodePath → full LangKey */
  key: (nodePath: string) => string;
  resolveLink: (url: string) => string | null;
  getDefinition?: (id: string) => any;
  imageSize?: (src: string) => { w: number; h: number } | undefined;
  warn: (msg: string) => void;
  error: (msg: string) => void;
  maxCodeLineBytes: number;
  fallbackTitle?: string;
}

/**
 * Hard-wrap code text so every emitted line stays within `maxBytes` UTF-8
 * bytes (code is raw, un-localized Text — the serializer caps raw strings).
 * Breaks at the last space inside the budget when possible.
 */
export function wrapCodeLines(value: string, maxBytes: number): string[] {
  const lines: string[] = [];
  for (const sourceLine of value.replace(/\r\n/g, '\n').split('\n')) {
    let rest = sourceLine;
    while (utf8Bytes(rest) > maxBytes) {
      // widest prefix that fits the byte budget
      let end = 0;
      let bytes = 0;
      for (const ch of rest) {
        const b = utf8Bytes(ch);
        if (bytes + b > maxBytes) break;
        bytes += b;
        end += ch.length;
      }
      const cut = rest.lastIndexOf(' ', end);
      const at = cut > 0 ? cut : end;
      lines.push(rest.slice(0, at));
      rest = rest.slice(at).replace(/^ +/, '');
    }
    lines.push(rest);
  }
  return lines;
}

/** Normalize a markdown image url to an RP texture path (no extension). */
function normalizeTexturePath(url: string): string {
  return url
    .replace(/^\.\//, '')
    .replace(/^\//, '')
    .replace(/\.(png|jpg|jpeg|tga)$/i, '');
}

/** Paragraph that is just one image (plus whitespace) → that image node. */
function soleImageOf(paragraph: MdastNode, ctx: CompilePageContext): MdastNode | null {
  let image;
  for (const child of paragraph.children) {
    if (child.type === 'text' && child.value.trim() === '') continue;
    let node = child;
    if (node.type === 'imageReference') {
      const def = ctx.getDefinition?.(node.identifier);
      if (!def) return undefined;
      node = { type: 'image', url: def.url, alt: node.alt };
    }
    if (node.type !== 'image' || image) return undefined;
    image = node;
  }
  return image;
}

/** Extract literal props from mdxJsxFlowElement attributes. */
function extractJsxProps(node: MdastNode, ctx: CompilePageContext): Record<string, any> {
  const props: Record<string, any> = {};
  for (const attr of node.attributes ?? []) {
    if (attr.type !== 'mdxJsxAttribute') {
      ctx.warn(`<${node.name}> spread attributes are not supported — skipped`);
      continue;
    }
    if (attr.value === null || attr.value === undefined) {
      props[attr.name] = true; // boolean shorthand
    } else if (typeof attr.value === 'string') {
      props[attr.name] = attr.value;
    } else {
      // mdxJsxAttributeValueExpression — accept JSON-compatible literals only
      try {
        props[attr.name] = JSON.parse(attr.value.value);
      } catch {
        ctx.warn(`<${node.name}> prop "${attr.name}" is a non-literal expression — skipped`);
      }
    }
  }
  return props;
}

/**
 * Compile one parsed page. `root` is an mdast root with the frontmatter node
 * already removed.
 */
export function compilePage(
  root: MdastNode,
  ctx: CompilePageContext,
): { titleK: string; title: string; blocks: any[]; lang: Map<string, string> } {
  const lang = new Map<string, string>();
  const inlineCtx = {
    resolveLink: ctx.resolveLink,
    getDefinition: ctx.getDefinition,
    warn: ctx.warn,
    error: ctx.error,
  };

  const inlineText = (children: MdastNode[]) => compileInline(children, inlineCtx);

  /** Inline content → its key minted at `path` (§-styling, incl. link color, already baked in), and its link spans. */
  const emitInline = ({ text, links }: InlineText, path: string): Record<string, any> => {
    const k = ctx.key(path);
    lang.set(k, text);
    return links.length > 0 ? { k, links } : { k };
  };

  const compileListItems = (listNode: MdastNode, basePath: string): any[] => {
    const items = [];
    for (const [i, itemNode] of listNode.children.entries()) {
      const itemPath = `${basePath}.i${i}`;
      // The item's paragraphs are one string, a space apart, with each paragraph's link spans
      // moved along by the text in front of it.
      const collected: InlineText = { text: '', links: [] };
      let nested;

      for (const child of itemNode.children ?? []) {
        if (child.type === 'paragraph') {
          const { text, links } = inlineText(child.children);
          const offset = collected.text === '' ? 0 : collected.text.length + 1;
          collected.text = collected.text === '' ? text : `${collected.text} ${text}`;
          for (const link of links) collected.links.push({ to: link.to, at: [link.at[0] + offset, link.at[1] + offset] });
        } else if (child.type === 'list') {
          nested = compileListItems(child, itemPath);
        } else {
          ctx.warn(`list items only support text and nested lists — "${child.type}" skipped`);
        }
      }

      const item: Record<string, any> = emitInline(collected, itemPath);
      if (nested && nested.length > 0) item.items = nested;
      items.push(item);
    }
    return items;
  };

  const compileBlocks = (children: MdastNode[], prefix: string): any[] => {
    const blocks: any[] = [];

    const blockPath = () => `${prefix}b${blocks.length}`;

    const handle = (node: MdastNode): void => {
      switch (node.type) {
        case 'heading': {
          if (node.depth > 3) ctx.warn(`heading depth ${node.depth} clamped to 3`);
          const k = ctx.key(blockPath());
          // Headings render as one label — links inside a heading collapse to plain
          // styled text (no inline pressable heading runs; a v1 limitation).
          const { text } = inlineText(node.children);
          lang.set(k, text);
          blocks.push({ t: 'h', l: Math.min(node.depth, 3), k });
          break;
        }
        case 'paragraph': {
          const image = soleImageOf(node, ctx);
          if (image) {
            const src = normalizeTexturePath(image.url);
            const block: Record<string, any> = { t: 'img', src };
            if (image.alt) block.alt = image.alt;
            const size = ctx.imageSize?.(src);
            if (size) {
              block.w = size.w;
              block.h = size.h;
            }
            blocks.push(block);
            break;
          }
          const path = blockPath();
          blocks.push({ t: 'p', ...emitInline(inlineText(node.children), path) });
          break;
        }
        case 'list': {
          const items = compileListItems(node, blockPath());
          const block: Record<string, any> = node.ordered ? { t: 'ol', items } : { t: 'ul', items };
          if (node.ordered && typeof node.start === 'number' && node.start !== 1) {
            block.start = node.start;
          }
          blocks.push(block);
          break;
        }
        case 'code': {
          const block: Record<string, any> = { t: 'code', lines: wrapCodeLines(node.value ?? '', ctx.maxCodeLineBytes) };
          if (node.lang) block.lang = node.lang;
          blocks.push(block);
          break;
        }
        case 'thematicBreak':
          blocks.push({ t: 'hr' });
          break;
        case 'blockquote': {
          const path = blockPath();
          blocks.push({ t: 'adm', kind: 'note', blocks: compileBlocks(node.children, `${path}.`) });
          break;
        }
        case 'containerDirective': {
          const kind = ADMONITION_KINDS[node.name as keyof typeof ADMONITION_KINDS];
          if (!kind) {
            ctx.warn(`unknown directive ":::${node.name}" — contents rendered without a container`);
            for (const child of node.children) handle(child);
            break;
          }
          const path = blockPath();
          let bodyChildren = node.children;
          const block: Record<string, any> = { t: 'adm', kind };
          if (bodyChildren[0]?.data?.directiveLabel) {
            const titleK = ctx.key(`${path}.t`);
            const titleText = inlineText(bodyChildren[0].children).text;
            lang.set(titleK, `${ADMONITION_COLORS[kind as keyof typeof ADMONITION_COLORS]}§l${titleText}`);
            block.titleK = titleK;
            bodyChildren = bodyChildren.slice(1);
          }
          block.blocks = compileBlocks(bodyChildren, `${path}.`);
          blocks.push(block);
          break;
        }
        case 'table':
          ctx.warn('tables are not supported yet — skipped');
          break;
        case 'mdxJsxFlowElement': {
          if (!node.name) {
            for (const child of node.children ?? []) handle(child); // <>fragment</>
            break;
          }
          const path = blockPath();
          const block: Record<string, any> = { t: 'cmp', name: node.name };
          const props = extractJsxProps(node, ctx);
          if (Object.keys(props).length > 0) block.props = props;
          const inner = compileBlocks(node.children ?? [], `${path}.`);
          if (inner.length > 0) block.blocks = inner;
          blocks.push(block);
          break;
        }
        case 'mdxjsEsm':
          ctx.warn('import/export statements are not supported in guides — skipped');
          break;
        case 'mdxFlowExpression':
          ctx.warn('JSX expressions are not supported in guides — skipped');
          break;
        case 'definition':
        case 'footnoteDefinition':
        case 'yaml':
        case 'leafDirective':
        case 'textDirective':
          break; // consumed elsewhere or meaningless in a guide
        case 'html':
          ctx.warn('raw HTML is not supported — skipped');
          break;
        default:
          ctx.warn(`unsupported block "${node.type}" — skipped`);
      }
    };

    for (const node of children) handle(node);
    return blocks;
  };

  // Title, for the sidebar row and the page header only: frontmatter first, then a leading h1,
  // then the caller-provided fallback (humanized filename). The body is rendered exactly as
  // authored, a leading h1 included.
  const children = root.children;
  let title = typeof ctx.frontmatter.title === 'string' ? ctx.frontmatter.title : undefined;
  if (children[0]?.type === 'heading' && children[0].depth === 1) {
    title ??= inlineText(children[0].children).text;
  }
  title ??= ctx.fallbackTitle ?? '';

  const titleK = ctx.key('title');
  lang.set(titleK, title);

  return { titleK, title, blocks: compileBlocks(children, ''), lang };
}
