// The proof search tree (build step 2) as pure data and rules, adapted from
// open-math-harness `interfaces/discovery` (scoring) and
// `program-files/discovery` (the tree, `admit` and `InitialPolicy`),
// Apache-2.0.
//
// Node 0 is the frozen statement. The one operation is CONTINUE(v): a worker
// starts from node v's file and hands back exactly one child, which the
// harness, not the worker, evaluates and scores. The policy only decides
// which nodes to continue, how many at once and when to stop.

export type NodeStatus = "invalid" | "errors" | "sorries" | "complete" | "rejected" | "verified" | "no verdict";

export type SearchNode = {
  id: number;
  parent: number | null;
  depth: number;
  /** The node's whole Lean file. */
  file: string;
  status: NodeStatus;
  score: number;
  /** What the checker said: Lean's output, the refusal or the rejection. */
  detail: string;
  /** Errors Lean reported, and `sorry`s left open, when Lean ran. */
  errors: number;
  sorries: number;
  /** How many continuations this node has received. */
  continued: number;
  round: number;
  /** The worker's own one-line description of its approach: untrusted text. */
  approach: string;
  /** The tool-loop task whose workspace holds this node's files (`t000001`), when a tool-loop worker made it. */
  task?: string;
};

/** Partial credit without the Lean analysis: see `partialScore`. With it, `sketchScore` in core/lean/sketch.ts. */

export type Limits = {
  /** Width: most continuations per round. */
  w: number;
  /** Most decision rounds. */
  k1: number;
  /** Most continuations of one non-root node in total. */
  fanout: number;
  /** Model calls one worker may make for its continuation. */
  callsPerContinuation: number;
  /** Model calls the whole search may make. */
  modelCalls: number;
};

export const DEFAULT_LIMITS: Limits = { w: 3, k1: 4, fanout: 2, callsPerContinuation: 3, modelCalls: 36 };

/**
 * The task-scoring table of upstream's scoring protocol, version 3. A
 * partial proof scores the base 0.5 here; `partialScore` adds the credit.
 */
export function scoreOf(status: NodeStatus): number {
  switch (status) {
    case "verified":
      return 1.0;
    case "complete":
    case "rejected":
      return 0.9;
    case "sorries":
      return 0.5;
    case "errors":
      return 0.05;
    case "no verdict":
      return 0.05;
    case "invalid":
      return 0.0;
  }
}

/**
 * Upstream's credit for a partial proof, 0.5 + 0.4 · C / (C + L), with a
 * simpler C: the `have`/`obtain` steps of a file Lean elaborated whose line
 * holds no `sorry`. Upstream also discounts steps its fixed automation suite
 * proves outright and scores 0.5 when an open leaf is hollow; Mack does not
 * run that analysis yet. L is the number of open `sorry`s.
 */
export function partialScore(file: string, openSorries: number): number {
  const closed = file.split("\n").filter((l) => /^\s*(have|obtain)\b/.test(l) && !/\bsorry\b/.test(l)).length;
  const total = closed + openSorries;
  return total === 0 ? 0.5 : 0.5 + (0.4 * closed) / total;
}

export class SearchTree {
  readonly nodes: SearchNode[] = [];

  constructor(root: Omit<SearchNode, "id" | "parent" | "depth" | "continued" | "round">) {
    this.nodes.push({ ...root, id: 0, parent: null, depth: 0, continued: 0, round: 0 });
  }

  /** A tree rebuilt from its journal, for a resume: the nodes as recorded, in id order. */
  static from(nodes: SearchNode[]): SearchTree {
    const t = new SearchTree(nodes[0]);
    t.nodes.length = 0;
    t.nodes.push(...nodes.map((n) => ({ ...n })));
    return t;
  }

  add(parent: number, child: Omit<SearchNode, "id" | "parent" | "depth" | "continued">): SearchNode {
    const p = this.nodes[parent];
    const node: SearchNode = { ...child, id: this.nodes.length, parent, depth: p.depth + 1, continued: 0 };
    this.nodes.push(node);
    return node;
  }

  isLeaf(id: number): boolean {
    return !this.nodes.some((n) => n.parent === id);
  }

  /** The root plus the leaves, sorted by (score desc, open sorries asc, depth asc, id asc). */
  continuable(fanout: number): SearchNode[] {
    return this.nodes
      .filter((n) => n.id === 0 || (this.isLeaf(n.id) && n.continued < fanout))
      .sort((a, b) => b.score - a.score || a.sorries - b.sorries || a.depth - b.depth || a.id - b.id);
  }

  solved(): SearchNode | undefined {
    return this.nodes.find((n) => n.status === "verified");
  }

  /** The path of files from the root to `id`, root first. */
  lineage(id: number): SearchNode[] {
    const path: SearchNode[] = [];
    for (let n: SearchNode | undefined = this.nodes[id]; n; n = n.parent === null ? undefined : this.nodes[n.parent]) path.unshift(n);
    return path;
  }
}

/**
 * The built-in policy (upstream's generation-0 `InitialPolicy`): `w` copies
 * of the root in round 1; afterwards the continuable nodes in order, minus
 * invalid ones, with the most repairable `errors` node (fewest errors) moved
 * to the front.
 */
export function initialPolicy(tree: SearchTree, w: number, fanout: number): number[] {
  if (tree.nodes.length <= 1) return Array(w).fill(0);
  const eligible = tree.continuable(fanout).filter((n) => n.id === 0 || n.status !== "invalid");
  let repair: SearchNode | undefined;
  for (const n of eligible) if (n.id !== 0 && n.status === "errors" && (!repair || n.errors < repair.errors)) repair = n;
  const batch = repair ? [repair.id, ...eligible.filter((n) => n !== repair).map((n) => n.id)] : eligible.map((n) => n.id);
  return batch.slice(0, w);
}

/**
 * The legal part of a batch (upstream `ProblemTree::admit`): at most `w`
 * entries, continuable nodes only, no non-root node past its fan-out. A
 * batch shorter than `w` is topped up from the root, which is exempt.
 */
export function admit(tree: SearchTree, batch: number[], w: number, fanout: number): number[] {
  const allowed = new Set(tree.continuable(fanout).map((n) => n.id));
  const used = new Map<number, number>();
  const out: number[] = [];
  for (const id of batch) {
    if (out.length >= w || !allowed.has(id)) continue;
    const n = (used.get(id) ?? 0) + 1;
    if (id !== 0 && tree.nodes[id].continued + n > fanout) continue;
    used.set(id, n);
    out.push(id);
  }
  while (out.length < w) out.push(0);
  return out;
}
