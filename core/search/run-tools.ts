// The chat's tools for proof-search runs (upstream `interfaces/discovery`:
// start, status, list, tree, stop, resume as tools). Starting or resuming
// spends model budget, so both are protected: each waits for the person's
// approval. A run is asynchronous: the chat starts it, sets itself a reminder
// and is told when it ends.

import type { ToolSpec } from "../chat/tools";

export const RUN_TOOLS: ToolSpec[] = [
  {
    name: "discovery_start",
    description: "Start a proof-search run on frozen .lean files of the project (each theorem proved by sorry). Spends model budget; needs the person's approval. Returns at once; the chat is told when it ends.",
    args: { problems: "array of .lean files or folders of them", "run?": "a name for the run", "width?": "workers per round", "rounds?": "rounds per problem", "worker?": "fixed or tool", "concurrency?": "problems at once (1–4)" },
    protected: true,
  },
  { name: "discovery_status", description: "A run's problems, their state and best score, and what keeps going wrong.", args: { run: "the run" }, protected: false },
  { name: "discovery_list", description: "This project's proof-search runs.", args: {}, protected: false },
  { name: "discovery_tree", description: "One problem's search tree in a run: every node, its parent, status and score.", args: { run: "the run", problem: "the problem id" }, protected: false },
  { name: "discovery_stop", description: "Stop a run; nothing it did is undone and its journal is kept.", args: { run: "the run" }, protected: false },
  { name: "discovery_resume", description: "Continue an interrupted or stopped run from its journal. Spends model budget; needs the person's approval.", args: { run: "the run" }, protected: true },
];
