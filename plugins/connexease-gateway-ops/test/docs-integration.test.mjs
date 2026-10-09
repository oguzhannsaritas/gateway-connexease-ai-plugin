import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const json = (path) => JSON.parse(read(path));

test('one Claude operations installation contains docs ask and keeps account tools separate', () => {
  const marketplace = json('.claude-plugin/marketplace.json');
  assert.deepEqual(marketplace.plugins.map(({ name }) => name), ['connexease-gateway-ops', 'connexease-gateway-docs']);
  const ops = marketplace.plugins[0];
  assert.equal(ops.source, './plugins/connexease-gateway-ops');
  assert.ok(existsSync(resolve(root, 'plugins/connexease-gateway-ops/skills/ask/SKILL.md')));
  assert.ok(existsSync(resolve(root, 'plugins/connexease-gateway-ops/skills/ask/references/sources.md')));
  assert.match(read('plugins/connexease-gateway-ops/skills/ask/SKILL.md'), /Public documentation never authorizes a write/);
  assert.match(read('plugins/connexease-gateway-ops/skills/ask/SKILL.md'), /connexease-gateway-ops:panel-ops/);
  assert.ok(existsSync(resolve(root, 'plugins/connexease-gateway-ops/.mcp.json')));
  assert.ok(!existsSync(resolve(root, 'plugins/connexease-gateway-docs/.mcp.json')));
});

test('portable Codex and Gemini packages stay documentation-only', () => {
  const marketplace = json('.agents/plugins/marketplace.json');
  assert.deepEqual(marketplace.plugins.map(({ name }) => name), ['connexease-gateway-docs']);
  const docsPath = marketplace.plugins[0].source.path;
  assert.equal(docsPath, './plugins/connexease-gateway-docs');
  assert.equal(json(`${docsPath}/plugin.json`).name, 'connexease-gateway-docs');
  assert.ok(existsSync(resolve(root, docsPath, 'skills/ask/SKILL.md')));
  assert.ok(existsSync(resolve(root, 'gemini-cli/connexease-gateway-docs/SKILL.md')));
  assert.match(read('gemini-cli/connexease-gateway-docs/SKILL.md'), /read-only/);
});

test('operations package and MCP server use the same version', () => {
  const version = '0.10.0';
  assert.equal(json('plugins/connexease-gateway-ops/package.json').version, version);
  assert.equal(json('plugins/connexease-gateway-ops/.claude-plugin/plugin.json').version, version);
  assert.match(read('plugins/connexease-gateway-ops/src/server.mjs'), /version: '0\.10\.0'/);
});
