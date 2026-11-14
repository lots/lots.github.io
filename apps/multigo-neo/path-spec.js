/* Position-path DSL shared by the editor, the embed viewer and the Node tests.
 *
 * Grammar (identical in spirit to BesoGo's `path` attribute):
 *   N<n> / n<n>   move n nodes forward along first children ("next" mode)
 *   B<n> / b<n>   pick the n-th child of the current node ("branch" mode,
 *                 1-based, 0 selects the last child)
 *   any other character is a separator
 *
 * Examples: "20" -> 20 first-child steps; "n5b1b1" -> five next steps, then
 * the first child twice; "b2,3,0,1" -> second, third, last, first child.
 */
(function (root) {
  'use strict';

  const MAX_STEPS = 20000;

  function parse(spec) {
    const tokens = [];
    let mode = 'next';
    let digits = '';
    const flush = () => {
      if (!digits) return;
      const value = Number(digits);
      digits = '';
      if (Number.isFinite(value)) tokens.push({ mode, value });
    };
    for (const char of String(spec == null ? '' : spec)) {
      if (char === 'n' || char === 'N') { flush(); mode = 'next'; }
      else if (char === 'b' || char === 'B') { flush(); mode = 'branch'; }
      else if (char >= '0' && char <= '9') digits += char;
      else flush();
    }
    flush();
    return tokens;
  }

  function resolve(spec, tree, startId) {
    if (!tree || !tree.root) return null;
    const tokens = parse(spec);
    let id = startId == null ? tree.root.id : startId;
    let steps = 0;
    for (const token of tokens) {
      if (!tree.get(id)) return id;
      if (token.mode === 'next') {
        for (let i = 0; i < token.value; i += 1) {
          const node = tree.get(id);
          if (!node || !node.children.length) return id;
          id = node.children[0].id;
          if ((steps += 1) >= MAX_STEPS) return id;
        }
      } else {
        const node = tree.get(id);
        if (!node || !node.children.length) return id;
        const index = token.value === 0
          ? node.children.length - 1
          : Math.min(token.value - 1, node.children.length - 1);
        id = node.children[Math.max(0, index)].id;
        if ((steps += 1) >= MAX_STEPS) return id;
      }
    }
    return id;
  }

  // Builds a branch-mode spec that reaches `targetId`. Every step uses B<k>,
  // which round-trips exactly through resolve() for any variation tree.
  function build(tree, targetId) {
    if (!tree || targetId == null || !tree.get(targetId)) return '';
    const indices = [];
    let node = tree.get(targetId);
    while (node && node.parentId != null) {
      const parent = tree.get(node.parentId);
      if (!parent) break;
      const index = parent.children.findIndex((child) => child.id === node.id);
      if (index < 0) break;
      indices.push(index + 1);
      node = parent;
    }
    indices.reverse();
    return indices.map((index) => `B${index}`).join('');
  }

  const api = { parse, resolve, build, MAX_STEPS };
  root.MultiGoPath = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof globalThis !== 'undefined' ? globalThis : this));
