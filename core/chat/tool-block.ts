// How a reply asks for a tool, shared by the agent (which runs the calls) and
// the chat screen (which hides them). Models are told to write a ```tool
// fence, but some write `<tool>…</tool>` or `<tool_call>…</tool_call>` (as
// Qwen and DeepSeek are trained to), mix them (`<tool>` closed by ```), or
// stop before closing; every one of these is a call. Imports nothing, so the
// renderer can use it.

/** One tool block; group 1 is its JSON. */
export const TOOL_BLOCK = /(?:```tool|<tool_call>|<tool>)[ \t]*\n?([\s\S]*?)(?:```|<\/tool_call>|<\/tool>|$)/g;

/** A ```json block, which some models use for a call: it is one only when its JSON names a tool. */
export const JSON_BLOCK = /```json[ \t]*\n([\s\S]*?)```/g;
