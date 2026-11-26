// What a formula reads, and the graph algorithms that need no sheet. Positions are 0-based { row, col }.
import { MAX_COLS, MAX_ROWS } from './a1.js';

const inLimits = (row, col) => row >= 0 && col >= 0 && row < MAX_ROWS && col < MAX_COLS;

// { cells: [{ row, col }], ranges: [{ r1, c1, r2, c2 }] } read by a parsed formula (ranges normalised, corner order fixed).
// References outside every possible sheet are left out: they evaluate to #REF! whatever the sheet holds.
export function collectDeps(ast) {
  const cells = [];
  const ranges = [];
  const stack = [ast];
  while (stack.length) {
    const n = stack.pop();
    switch (n.t) {
      case 'ref':
        if (inLimits(n.row, n.col)) cells.push({ row: n.row, col: n.col });
        break;
      case 'range':
        if (inLimits(n.a.row, n.a.col) && inLimits(n.b.row, n.b.col)) {
          ranges.push({
            r1: Math.min(n.a.row, n.b.row),
            c1: Math.min(n.a.col, n.b.col),
            r2: Math.max(n.a.row, n.b.row),
            c2: Math.max(n.a.col, n.b.col),
          });
        }
        break;
      case 'un':
        stack.push(n.x);
        break;
      case 'bin':
        stack.push(n.l, n.r);
        break;
      case 'call':
        for (const a of n.args) stack.push(a);
        break;
      default:
        break;
    }
  }
  return { cells, ranges };
}

// Strongly connected components of a graph given as Map node -> [nodes it depends on], emitted so that every component comes
// AFTER the components it depends on. Iterative (no recursion), so a chain of 50,000 formulas is safe.
// Returns [{ nodes: [...], cyclic: boolean }]; cyclic means more than one node, or a node that depends on itself.
export function components(nodes, adjacency) {
  const index = new Map();
  const low = new Map();
  const onStack = new Set();
  const stack = [];
  const out = [];
  let counter = 0;
  for (const start of nodes) {
    if (index.has(start)) continue;
    index.set(start, counter);
    low.set(start, counter);
    counter += 1;
    stack.push(start);
    onStack.add(start);
    const work = [[start, 0]];
    while (work.length) {
      const frame = work[work.length - 1];
      const v = frame[0];
      const edges = adjacency.get(v) ?? [];
      if (frame[1] < edges.length) {
        const w = edges[frame[1]];
        frame[1] += 1;
        if (!index.has(w)) {
          index.set(w, counter);
          low.set(w, counter);
          counter += 1;
          stack.push(w);
          onStack.add(w);
          work.push([w, 0]);
        } else if (onStack.has(w)) {
          low.set(v, Math.min(low.get(v), index.get(w)));
        }
      } else {
        work.pop();
        if (work.length) {
          const parent = work[work.length - 1][0];
          low.set(parent, Math.min(low.get(parent), low.get(v)));
        }
        if (low.get(v) === index.get(v)) {
          const comp = [];
          let w;
          do {
            w = stack.pop();
            onStack.delete(w);
            comp.push(w);
          } while (w !== v);
          out.push({ nodes: comp, cyclic: comp.length > 1 || (adjacency.get(comp[0]) ?? []).includes(comp[0]) });
        }
      }
    }
  }
  return out;
}
