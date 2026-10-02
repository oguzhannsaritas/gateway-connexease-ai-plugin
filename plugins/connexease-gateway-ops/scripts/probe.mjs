import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const serverPath = fileURLToPath(new URL('../src/server.mjs', import.meta.url));
const transport = new StdioClientTransport({ command: process.execPath, args: [serverPath] });
const client = new Client({ name: 'gateway-ops-probe', version: '0.1.0' });

try {
  await client.connect(transport);
  const tools = (await client.listTools()).tools.map(({ name }) => name);
  assert.deepEqual([...tools].sort(), [
    'get_my_profile',
    'list_my_applications',
    'get_application',
    'list_whatsapp_templates',
    'get_whatsapp_template',
    'get_webhook_status',
    'list_api_key_metadata',
    'list_sandbox_test_numbers',
    'prepare_sandbox_text',
  ].sort());
  console.log(JSON.stringify({
    tools,
    notice: 'Tool discovery only. No Gateway request was sent.',
  }, null, 2));
} finally {
  await client.close();
}
