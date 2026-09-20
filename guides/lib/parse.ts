// MDX/markdown parsing — one unified pipeline for every guide file.
//
// Both .md and .mdx run through the same processor (including remark-mdx) so
// document structure never depends on the file extension — key assignment
// must stay identical across locales. Consequence: a literal '<' in prose
// must be escaped (\<), exactly like Docusaurus in MDX mode.

import { definitions } from 'mdast-util-definitions';
import remarkDirective from 'remark-directive';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkMdx from 'remark-mdx';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { parse as parseYaml } from 'yaml';

const processor = unified()
  .use(remarkParse)
  .use(remarkFrontmatter, ['yaml'])
  .use(remarkGfm)
  .use(remarkDirective)
  .use(remarkMdx);

/**
 * Parse one guide source file.
 *
 * Throws on MDX syntax errors; the caller reports file + message.
 *
 * The mdast tree stays untyped: this filter walks it structurally, and pinning
 * it to a node union would have to be re-pinned on every remark upgrade.
 */
export function parseGuideFile(source: string): {
  frontmatter: Record<string, any>;
  root: any;
  getDefinition: (id: string) => any;
} {
  const root: any = processor.runSync(processor.parse(source));

  let frontmatter: Record<string, any> = {};
  if (root.children[0]?.type === 'yaml') {
    frontmatter = parseYaml(root.children[0].value) ?? {};
    root.children = root.children.slice(1);
  }

  return { frontmatter, root, getDefinition: definitions(root) };
}

/** 'first-screen' → 'First Screen' — last-resort page title. */
export function humanizeFilename(name: string): string {
  return name
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
