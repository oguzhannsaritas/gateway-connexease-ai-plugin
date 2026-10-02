import assert from 'node:assert/strict';
import test from 'node:test';
import { GatewayApiClient } from '../src/gateway-api.mjs';

const app = { id: '00000000-0000-4000-8000-000000000002', appId: 'example-app', displayName: 'Example App', status: 'ACTIVATED' };
const number = { id: '00000000-0000-4000-8000-000000000001', appId: 'example-app', title: 'Test recipient', phoneNumber: '+15555550101' };

function response(data, status = 200) {
  return new Response(JSON.stringify({ isSuccess: status < 400, data }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function fixture(fetchImpl) {
  return new GatewayApiClient({
    accessTokenProvider: { getAccessToken: async () => 'test-access-token' },
    baseUrl: 'https://gateway.example.test/api/v1',
    fetchImpl,
  });
}

test('requires a credential provider and clean HTTPS API URL', () => {
  assert.throws(() => new GatewayApiClient({}), /access token provider/);
  assert.throws(() => new GatewayApiClient({
    accessTokenProvider: { getAccessToken: async () => 'x' },
    baseUrl: 'http://gateway.example.test/api/v1',
  }), /HTTPS/);
});

test('reads real-contract applications with bearer authorization', async () => {
  const calls = [];
  const client = fixture(async (url, options) => {
    calls.push({ url: String(url), options });
    return response([app]);
  });
  assert.deepEqual(await client.listApplications(), [app]);
  assert.equal(calls[0].url, 'https://gateway.example.test/api/v1/applications');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer test-access-token');
  assert.equal(calls[0].options.redirect, 'error');
});

test('prepares a real-contract text without a write request', async () => {
  const paths = [];
  const client = fixture(async (url, options) => {
    assert.equal(options.method, 'GET');
    paths.push(url.pathname);
    if (url.pathname.endsWith('/applications')) return response([app]);
    if (url.pathname.endsWith('/sandbox/test-numbers')) return response([number]);
    throw new Error('unexpected path');
  });
  const prepared = await client.prepareSandboxText({
    appId: 'example-app', testNumberId: number.id, message: 'Hello',
  });
  assert.equal(prepared.status, 'not_sent');
  assert.equal(prepared.preview.phoneNumber, number.phoneNumber);
  assert.deepEqual(paths, [
    '/api/v1/applications',
    '/api/v1/applications/example-app/sandbox/test-numbers',
  ]);
});

test('rejects a test number from another application', async () => {
  const client = fixture(async (url) => {
    if (url.pathname.endsWith('/applications')) return response([app]);
    return response([{ ...number, appId: 'other-app' }]);
  });
  await assert.rejects(client.prepareSandboxText({
    appId: 'example-app', testNumberId: number.id, message: 'Hello',
  }), /Test number not found/);
});

test('does not call the test number endpoint for an unknown application', async () => {
  let calls = 0;
  const client = fixture(async () => { calls += 1; return response([]); });
  await assert.rejects(client.listTestNumbers('unknown-app'), /Application not found/);
  assert.equal(calls, 1);
});

test('validates inputs and sanitizes authorization errors', async () => {
  const client = fixture(async () => response(null, 401));
  await assert.rejects(client.listApplications(), /session expired/);
  await assert.rejects(client.prepareSandboxText({
    appId: 'example-app', testNumberId: 'not-a-uuid', message: 'Hello',
  }), /UUID/);
  await assert.rejects(client.prepareSandboxText({
    appId: 'example-app', testNumberId: number.id, message: ' ',
  }), /message must contain/);
});

test('reads application and templates only through allowlisted GET requests', async () => {
  const paths = [];
  const template = { sourceId: '12345', name: 'hello', language: 'en_US', category: 'UTILITY', status: 'APPROVED', components: [{ type: 'BODY', text: 'Hello' }], secret: 'hidden' };
  const client = fixture(async (url, options) => {
    assert.equal(options.method, 'GET');
    paths.push(url.pathname);
    if (url.pathname.endsWith('/applications')) return response([app]);
    if (url.pathname.endsWith('/applications/example-app')) return response({ ...app, createdAt: '2026-01-01', secret: 'hidden' });
    if (url.pathname.endsWith('/templates')) return response([template]);
    if (url.pathname.endsWith('/templates/12345')) return response(template);
    throw new Error('unexpected path');
  });
  assert.equal((await client.getApplication(app.appId)).secret, undefined);
  assert.equal((await client.listWhatsappTemplates(app.appId)).items[0].components, undefined);
  const detail = await client.getWhatsappTemplate(app.appId, '12345');
  assert.deepEqual(detail.components, template.components);
  assert.equal(detail.secret, undefined);
  assert.deepEqual(paths, [
    '/api/v1/applications', '/api/v1/applications/example-app',
    '/api/v1/applications', '/api/v1/channels/whatsapp/applications/example-app/templates',
    '/api/v1/applications', '/api/v1/channels/whatsapp/applications/example-app/templates/12345',
  ]);
});

test('never exposes webhook secret headers or raw API keys', async () => {
  const client = fixture(async (url, options) => {
    assert.equal(options.method, 'GET');
    if (url.pathname.endsWith('/applications')) return response([app]);
    if (url.pathname.endsWith('/webhook')) return response({ id: 'webhook-id', url: 'https://example.test/hook', headers: { Authorization: 'secret-header' }, isActive: true });
    if (url.pathname.endsWith('/api-keys')) return response([{ id: 'key-id', appId: app.appId, name: 'test', key: 'sk_secret_value', isActive: true }]);
    throw new Error('unexpected path');
  });
  const webhook = await client.getWebhookStatus(app.appId);
  const keys = await client.listApiKeyMetadata(app.appId);
  assert.equal(webhook.headers, undefined);
  assert.equal(keys.items[0].key, undefined);
  assert.doesNotMatch(JSON.stringify({ webhook, keys }), /secret-header|sk_secret_value/);
});

test('blocks unowned applications and invalid template identifiers before detail reads', async () => {
  let calls = 0;
  const client = fixture(async () => { calls += 1; return response([app]); });
  await assert.rejects(client.getWebhookStatus('other-app'), /Application not found/);
  await assert.rejects(client.getWhatsappTemplate(app.appId, '../unsafe'), /sourceId must be/);
  assert.equal(calls, 1);
});

test('preserves pagination metadata and requests both required query parameters', async () => {
  const page = { currentPage: 2, pageSize: 3, totalCount: 7, hasNext: true };
  const urls = [];
  const client = fixture(async (url) => {
    if (url.pathname.endsWith('/applications')) return response([app]);
    urls.push(url);
    return new Response(JSON.stringify({ isSuccess: true, data: [], pagingMetadata: page }), { status: 200 });
  });
  assert.deepEqual(await client.listWhatsappTemplates(app.appId, 2, 3), { items: [], pagingMetadata: page });
  assert.deepEqual(await client.listApiKeyMetadata(app.appId, 2, 3), { items: [], pagingMetadata: page });
  assert.equal(urls.length, 2);
  for (const url of urls) {
    assert.equal(url.searchParams.get('pageNumber'), '2');
    assert.equal(url.searchParams.get('pageSize'), '3');
  }
  await assert.rejects(client.listApiKeyMetadata(app.appId, 0, 3), /pageNumber/);
});
