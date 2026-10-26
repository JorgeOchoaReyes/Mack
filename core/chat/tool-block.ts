// How a reply asks for a tool, shared by the agent (which runs the calls) and
// the chat screen (which hides them). Models are told to write a ```tool
// fence, but some write `<tool>…</tool>`, mix the two (`<tool>` closed by
// ```), or stop before closing; every one of these is a call. Imports
// nothing, so the renderer can use it.

/** One tool block; group 1 is its JSON. */
export const TOOL_BLOCK = /(?:```tool|<tool>)[ \t]*\n?([\s\S]*?)(?:```|<\/tool>|$)/g;
