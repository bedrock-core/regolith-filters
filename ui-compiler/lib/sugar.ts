// Desugars React's conditional-rendering idioms into carried visibility before
// a screen module is executed.
//
// `{cond && <X/>}` evaluates before any renderer sees it: when the condition
// is false all that remains is `false` — nobody can tell WHICH element is
// missing, and a compiled screen's shape and entry numbering are fixed at
// build time, so an element that comes and goes breaks the claims walk. The
// only place both branches still exist is the source text, so the conversion
// happens there, and the SAME rewritten source feeds both pipelines: the
// compiler executes it to bake the shape, the bundler ships it so the runtime
// walks an identical tree.
//
//   {cond && <X/>}          →  <X visible={cond} liveVisible={true}/>
//   {cond ? <A/> : <B/>}    →  <A visible={cond} liveVisible/><B visible={!(cond)} liveVisible/>
//   {cond ? <A/> : null}    →  <A visible={cond} liveVisible/>
//
// `liveVisible` tells the build to CARRY the visibility whether or not its
// liveness probe happens to flip it: a condition an author wrote is dynamic.
//
// An element that already carries `visible` keeps it, joined with `&&`. Only
// JSX children whose branches are single elements are rewritten — a string,
// fragment or call in a branch is left untouched (wrap it in an element to
// make it compilable).

import ts from 'typescript';

interface Edit {
  start: number;
  end: number;
  text: string;
}

/** `expr` with any wrapping parentheses removed. */
const unparen = (expr: ts.Expression): ts.Expression =>
  ts.isParenthesizedExpression(expr) ? unparen(expr.expression) : expr;

const isJsxTag = (node: ts.Node): node is ts.JsxElement | ts.JsxSelfClosingElement =>
  ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node);

const isNullish = (expr: ts.Expression): boolean =>
  expr.kind === ts.SyntaxKind.NullKeyword
  || (ts.isIdentifier(expr) && expr.text === 'undefined')
  || expr.kind === ts.SyntaxKind.FalseKeyword;

/** Rewrites every JSX conditional in `source`, or returns it verbatim. */
export const desugarJsxConditionals = (source: string, fileName = 'screen.tsx'): string => {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const edits: Edit[] = [];

  /** The element's opening attributes, wherever the kind keeps them. */
  const attributesOf = (element: ts.JsxElement | ts.JsxSelfClosingElement): ts.JsxAttributes =>
    ts.isJsxElement(element) ? element.openingElement.attributes : element.attributes;

  /**
   * Makes `element` carry `visible={cond}` — merged into an existing visible
   * with `&&`, injected after the tag name otherwise. All edits are disjoint
   * from the child edits the surrounding visit keeps collecting.
   */
  const carryVisible = (element: ts.JsxElement | ts.JsxSelfClosingElement, cond: string): void => {
    const attributes = attributesOf(element);
    const existing = attributes.properties.find(
      (attr): attr is ts.JsxAttribute => ts.isJsxAttribute(attr) && attr.name.getText(file) === 'visible',
    );

    if (existing === undefined) {
      const tag = ts.isJsxElement(element) ? element.openingElement.tagName : element.tagName;

      edits.push({ start: tag.end, end: tag.end, text: ` visible={${cond}} liveVisible={true}` });
      return;
    }

    // `visible` with no value is `true` — the condition alone decides.
    const value = existing.initializer !== undefined && ts.isJsxExpression(existing.initializer)
      ? existing.initializer.expression?.getText(file)
      : existing.initializer?.getText(file);
    const merged = value === undefined ? cond : `(${value}) && (${cond})`;

    edits.push({ start: existing.getStart(file), end: existing.end, text: `visible={${merged}} liveVisible={true}` });
  };

  const rewrite = (container: ts.JsxExpression): void => {
    if (container.expression === undefined) {
      return;
    }

    const expr = unparen(container.expression);

    if (
      ts.isBinaryExpression(expr)
      && expr.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
    ) {
      const element = unparen(expr.right);

      if (!isJsxTag(element)) {
        return;
      }

      edits.push(
        { start: container.getStart(file), end: element.getStart(file), text: '' },
        { start: element.end, end: container.end, text: '' },
      );
      carryVisible(element, expr.left.getText(file));
      visit(element);
      return;
    }

    if (ts.isConditionalExpression(expr)) {
      const cond = expr.condition.getText(file);
      const whenTrue = unparen(expr.whenTrue);
      const whenFalse = unparen(expr.whenFalse);
      const kept = [
        ...isJsxTag(whenTrue) ? [{ element: whenTrue, cond }] : [],
        ...isJsxTag(whenFalse) ? [{ element: whenFalse, cond: `!(${cond})` }] : [],
      ];

      // Every branch must be an element or nullish — a string or fragment in
      // one leaves the whole conditional alone rather than half-rewritten.
      const accounted = kept.length
        + [whenTrue, whenFalse].filter(branch => !isJsxTag(branch) && isNullish(branch)).length;

      if (kept.length === 0 || accounted !== 2) {
        return;
      }

      let cursor = container.getStart(file);

      for (const { element, cond: branchCond } of kept) {
        edits.push({ start: cursor, end: element.getStart(file), text: '' });
        carryVisible(element, branchCond);
        visit(element);
        cursor = element.end;
      }
      edits.push({ start: cursor, end: container.end, text: '' });
    }
  };

  const visit = (node: ts.Node): void => {
    if (ts.isJsxExpression(node) && node.parent !== undefined
      && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))) {
      rewrite(node);
      // A rewritten container queued its own child visits; an untouched one
      // has nothing conditional in children position deeper inside itself
      // that the walk below would miss, because rewrite() only returns early
      // on shapes with no JSX children of their own.
      if (edits.some(edit => edit.start >= node.getStart(file) && edit.end <= node.end)) {
        return;
      }
    }

    node.forEachChild(visit);
  };

  visit(file);

  if (edits.length === 0) {
    return source;
  }

  edits.sort((a, b) => a.start - b.start);

  let out = '';
  let cursor = 0;

  for (const edit of edits) {
    out += source.slice(cursor, edit.start) + edit.text;
    cursor = edit.end;
  }

  return out + source.slice(cursor);
};
