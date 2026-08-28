// Sidebar tree + prev/next pagination — Docusaurus conventions:
// folder structure defines categories, `_category_.json` files control label /
// position / collapsed / link, frontmatter `sidebar_position` orders pages,
// ordering falls back to alphabetical, prev/next follow sidebar DFS order.
//
// The tree is built ONCE, for the widest audience, with gated nodes marked (`a`) rather than
// removed — the renderer prunes it per viewer. Pagination cannot be pruned that cheaply (DFS
// order slots a category's `link` page ahead of its children), so both chains are walked here:
// `order` for an operator, `publicOrder` for everyone else.

import type { AccessResolver } from './access.ts';
import { catKey } from './keys.ts';
import { humanizeFilename } from './parse.ts';

export interface SidebarInput {
  /** PageId → { frontmatter, titleK } */
  pages: Map<string, any>;
  /** dirPath → parsed _category_.json */
  categories: Map<string, Record<string, any>>;
  /** key prefix ('<ns>.guides') */
  prefix: string;
  addLang: (key: string, value: string) => void;
  warn: (msg: string) => void;
  access: AccessResolver;
}

/** `order` / `publicOrder` are PageIds in sidebar DFS order. */
export function buildSidebar({ pages, categories, prefix, addLang, warn, access }: SidebarInput): {
  tree: any[];
  order: string[];
  publicOrder: string[];
} {
  // Group page ids and child directories per directory path ('' = root).
  const dirPages = new Map<string, string[]>(); // dirPath → PageId[]
  const dirChildren = new Map<string, Set<string>>(); // dirPath → Set<childDirPath>

  const ensureDir = (dirPath: string): void => {
    if (dirPages.has(dirPath)) return;
    dirPages.set(dirPath, []);
    dirChildren.set(dirPath, new Set());
    if (dirPath !== '') {
      const parent = dirPath.includes('/') ? dirPath.slice(0, dirPath.lastIndexOf('/')) : '';
      ensureDir(parent);
      dirChildren.get(parent)!.add(dirPath);
    }
  };

  ensureDir('');
  for (const pageId of pages.keys()) {
    const dir = pageId.includes('/') ? pageId.slice(0, pageId.lastIndexOf('/')) : '';
    ensureDir(dir);
    dirPages.get(dir)!.push(pageId);
  }
  for (const dirPath of categories.keys()) ensureDir(dirPath);

  const resolveCategoryLink = (dirPath: string, link: any): string | undefined => {
    if (link === undefined || link === null) return undefined;
    // Accept a plain PageId string or Docusaurus' { type: 'doc', id } form.
    const id = typeof link === 'string' ? link : link.type === 'doc' ? link.id : undefined;
    if (id === undefined) {
      warn(`_category_.json in "${dirPath}": unsupported link form — ignored`);
      return undefined;
    }
    const candidates = id.includes('/') ? [id] : [`${dirPath}/${id}`, id];
    for (const candidate of candidates) {
      if (pages.has(candidate)) return candidate;
    }
    warn(`_category_.json in "${dirPath}": link target "${id}" does not exist — ignored`);
    return undefined;
  };

  const buildDir = (dirPath: string): any[] => {
    const entries = [];

    for (const pageId of dirPages.get(dirPath) ?? []) {
      const page = pages.get(pageId);
      if (page.frontmatter.hidden === true) continue;
      const node: Record<string, any> = { t: 'page', id: pageId, titleK: page.titleK };
      const pageAccess = access.forPage(pageId, page.frontmatter);
      if (pageAccess !== undefined) node.a = pageAccess;
      if (page.icon !== undefined) node.icon = page.icon;
      if (page.descK !== undefined) node.descK = page.descK;
      entries.push({
        sort: [numberOr(page.frontmatter.sidebar_position, Infinity), pageId],
        node,
      });
    }

    for (const childDir of dirChildren.get(dirPath) ?? []) {
      const category = categories.get(childDir) ?? {};
      const dirName = childDir.slice(childDir.lastIndexOf('/') + 1);
      const labelK = catKey(prefix, childDir);
      addLang(labelK, typeof category.label === 'string' ? category.label : humanizeFilename(dirName));

      const node: Record<string, any> = { t: 'cat', id: childDir, labelK, children: buildDir(childDir) };
      const dirAccess = access.forDir(childDir);
      if (dirAccess !== undefined) node.a = dirAccess;
      if (category.collapsed === true) node.collapsed = true;
      if (typeof category.icon === 'string' && category.icon !== '') node.icon = category.icon;
      const link = resolveCategoryLink(childDir, category.link);
      if (link !== undefined) node.link = link;
      if (node.children.length === 0 && node.link === undefined) {
        warn(`category "${childDir}" has no visible pages — dropped from the sidebar`);
        continue;
      }
      entries.push({ sort: [numberOr(category.position, Infinity), dirName], node });
    }

    entries.sort((a, b) => ((a.sort[0] as number) - (b.sort[0] as number)) || (a.sort[1] < b.sort[1] ? -1 : 1));
    return entries.map((e) => e.node);
  };

  const tree = buildDir('');

  // DFS page order for prev/next: a category's link page slots in ahead of
  // its children (it acts as the category's landing page).
  //
  // `includeGated: false` walks the same tree as a non-operator sees it. A gated category is
  // skipped whole — its children inherited that gate, so descending could only re-skip them —
  // and a category `link` is tested by PAGE rather than by node, because a link may point at a
  // gated (or hidden) page the category itself does not carry.
  const buildOrder = (includeGated: boolean): string[] => {
    const out: string[] = [];
    const seen = new Set<string>();

    const gatedPage = (pageId: string): boolean => access.forPage(pageId, (pages.get(pageId) ?? {}).frontmatter ?? {}) !== undefined;

    const pushPage = (pageId: string): void => {
      if (seen.has(pageId)) return;
      if (!includeGated && gatedPage(pageId)) return;
      seen.add(pageId);
      out.push(pageId);
    };

    const visit = (nodes: any[]): void => {
      for (const node of nodes) {
        if (!includeGated && node.a !== undefined) continue;
        if (node.t === 'page') {
          pushPage(node.id);
        } else {
          if (node.link !== undefined) pushPage(node.link);
          visit(node.children);
        }
      }
    };

    visit(tree);
    return out;
  };

  const order = buildOrder(true);
  const publicOrder = buildOrder(false);

  return { tree, order, publicOrder };
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
