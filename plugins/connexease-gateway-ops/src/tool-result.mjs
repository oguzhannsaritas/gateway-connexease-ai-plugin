/** MCP structuredContent must be an object, including for list responses. */
export function toolResult(value) {
  const structuredContent = Array.isArray(value) ? { items: value } : value;
  if (structuredContent === null || typeof structuredContent !== 'object') {
    throw new TypeError('Gateway tool result must be an object or an array');
  }
  return {
    content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
    structuredContent,
  };
}
