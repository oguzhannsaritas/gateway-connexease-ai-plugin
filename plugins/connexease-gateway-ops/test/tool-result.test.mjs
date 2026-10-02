import assert from 'node:assert/strict';
import test from 'node:test';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { toolResult } from '../src/tool-result.mjs';

test('list tool results satisfy the MCP protocol for populated and empty lists', () => {
  for (const items of [[{ appId: 'app-1' }], []]) {
    const response = toolResult(items);
    assert.deepEqual(response.structuredContent, { items });
    assert.deepEqual(JSON.parse(response.content[0].text), { items });
    assert.deepEqual(CallToolResultSchema.parse(response).structuredContent, { items });
  }
});

test('object tool results retain their shape and satisfy the MCP protocol', () => {
  const value = { status: 'connected', sessionPersistence: 'memory_only' };
  const response = toolResult(value);
  assert.deepEqual(CallToolResultSchema.parse(response).structuredContent, value);
});

test('non-object tool results fail locally before crossing the MCP boundary', () => {
  for (const value of [null, undefined, 'invalid', 123]) {
    assert.throws(() => toolResult(value), /object or an array/);
  }
});
