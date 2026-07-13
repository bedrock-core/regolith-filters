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
 * @param {string} source
 * @returns {{ frontmatter: object, root: object, getDefinition: (id: string) => object | null }}
 * @throws on MDX syntax errors (caller reports file + message)
 */
export function parseGuideFile(source) {
  const root = processor.runSync(processor.parse(source));

  let frontmatter = {};
  if (root.children[0]?.type === 'yaml') {
    frontmatter = parseYaml(root.children[0].value) ?? {};
    root.children = root.children.slice(1);
  }

  return { frontmatter, root, getDefinition: definitions(root) };
}

/** 'first-screen' → 'First Screen' — last-resort page title. */
export function humanizeFilename(name) {
  return name
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
