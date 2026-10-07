import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { GatewayApiClient } from '../src/gateway-api.mjs';
import { createApiKey, createOrganizationSecret, performPanelAction } from '../src/panel-workflow.mjs';

const app = { id: '00000000-0000-4000-8000-000000000002', appId: 'example-app', displayName: 'Old name', status: 'ACTIVATED', channel: { platform: 'whatsapp', businessUsername: 'old_user' }, contact: { name: 'Old', email: 'old@example.test', phoneNumber: '+15555550101' } };
const number = { id: '00000000-0000-4000-8000-000000000001', appId: app.appId, title: 'Old label', phoneNumber: '+15555550102' };
const template = { id: '00000000-0000-4000-8000-000000000003', sourceId: '12345', name: 'hello', language: 'en_US', category: 'UTILITY', status: 'APPROVED', components: [{ type: 'BODY', text: 'Hello' }] };

function response(data, status = 200) {
  return status === 204 ? new Response(null, { status }) : new Response(JSON.stringify({ isSuccess: true, data }), { status });
}

function fixture(calls, getApp = () => app) {
  return new GatewayApiClient({
    accessTokenProvider: { getAccessToken: async () => 'test-token' },
    baseUrl: 'https://gateway.example.test/api/v1',
    fetchImpl: async (url, options) => {
      calls.push({ path: url.pathname, method: options.method, body: options.body ? JSON.parse(options.body) : undefined });
      if (options.method !== 'GET') return response(null, 204);
      if (url.pathname === '/api/v1/applications') return response([app]);
      if (url.pathname === '/api/v1/applications/example-app') return response(getApp());
      if (url.pathname.endsWith('/sandbox/test-numbers')) return response([number]);
      if (url.pathname.endsWith('/templates/12345')) return response(template);
      if (url.pathname.endsWith('/allowed-origins')) return response({ origins: ['https://old.example.test'] });
      throw new Error(`unexpected GET ${url.pathname}`);
    },
  });
}

test('application rename and contact updates use the matching channel route and one native approval', async () => {
  const calls = [];
  const client = fixture(calls);
  const renamed = await performPanelAction(client, async ({ preview }) => {
    assert.equal(preview.details.before.applicationName, 'Old name');
    assert.equal(preview.details.after.applicationName, 'New name');
    return true;
  }, 'rename_application', { appId: app.appId, applicationName: 'New name' });
  assert.equal(renamed.status, 'applied');
  const write = calls.filter(({ method }) => method === 'PATCH');
  assert.equal(write.length, 1);
  assert.equal(write[0].path, '/api/v1/channels/whatsapp/applications/example-app');
  assert.deepEqual(write[0].body, { applicationName: 'New name' });

  const contact = await performPanelAction(client, async () => true, 'update_application_contact', {
    appId: app.appId, contact: { email: 'new@example.test' },
  });
  assert.equal(contact.status, 'applied');
  assert.deepEqual(calls.filter(({ method }) => method === 'PATCH')[1].body, { contact: { email: 'new@example.test' } });
});

test('cancelled destructive action makes no write; confirmed delete accepts HTTP 204', async () => {
  const calls = [];
  const client = fixture(calls);
  const args = { appId: app.appId, testNumberId: number.id };
  assert.deepEqual(await performPanelAction(client, async () => false, 'delete_test_number', args), {
    status: 'cancelled', action: 'delete_test_number', changed: false,
  });
  assert.equal(calls.some(({ method }) => method === 'DELETE'), false);
  const deleted = await performPanelAction(client, async () => true, 'delete_test_number', args);
  assert.equal(deleted.status, 'applied');
  assert.equal(calls.filter(({ method }) => method === 'DELETE').length, 1);
});

test('changed application data after confirmation blocks a write', async () => {
  let detailReads = 0;
  const calls = [];
  const client = fixture(calls, () => ({ ...app, displayName: ++detailReads === 1 ? 'Old name' : 'Changed externally' }));
  await assert.rejects(performPanelAction(client, async () => true, 'rename_application', {
    appId: app.appId, applicationName: 'New name',
  }), /data changed/);
  assert.equal(calls.some(({ method }) => method === 'PATCH'), false);
});

test('allowed origins use exact allowlisted path; template deletion requires ownership', async () => {
  const calls = [];
  const client = fixture(calls);
  const added = await performPanelAction(client, async () => true, 'add_allowed_origin', { origin: 'https://new.example.test' });
  assert.equal(added.status, 'applied');
  const post = calls.find(({ method }) => method === 'POST');
  assert.equal(post.path, '/api/v1/organizations/allowed-origins');
  assert.deepEqual(post.body, { origin: 'https://new.example.test' });
  await assert.rejects(client.preparePanelAction('add_allowed_origin', { origin: 'https://evil.test/path' }), /without a path/);
  const deleted = await performPanelAction(client, async () => true, 'delete_whatsapp_template', { appId: app.appId, sourceId: template.sourceId });
  assert.equal(deleted.status, 'applied');
  assert.equal(calls.at(-1).path, '/api/v1/channels/whatsapp/applications/example-app/templates/12345');
  assert.equal(calls.at(-1).method, 'DELETE');
});

test('webhook updates preserve unexposed secret headers and require confirmation', async () => {
  const calls = [];
  const client = new GatewayApiClient({
    accessTokenProvider: { getAccessToken: async () => 'test-token' },
    baseUrl: 'https://gateway.example.test/api/v1',
    fetchImpl: async (url, options) => {
      calls.push({ path: url.pathname, method: options.method, body: options.body ? JSON.parse(options.body) : undefined });
      if (options.method !== 'GET') return response({ id: 'wh-1' });
      if (url.pathname === '/api/v1/applications') return response([app]);
      if (url.pathname.endsWith('/webhook')) return response({ id: 'wh-1', url: 'https://old.example.test/hook', headers: { Authorization: 'secret' }, subscribedEvents: { messages: true } });
      throw new Error(`unexpected GET ${url.pathname}`);
    },
  });
  const result = await performPanelAction(client, async ({ preview }) => {
    assert.doesNotMatch(JSON.stringify(preview), /secret/);
    return true;
  }, 'upsert_webhook', { appId: app.appId, url: 'https://new.example.test/hook' });
  assert.equal(result.status, 'applied');
  const post = calls.find(({ method }) => method === 'POST');
  assert.equal(post.path, '/api/v1/applications/example-app/webhook');
  assert.deepEqual(post.body, { url: 'https://new.example.test/hook' });
  assert.equal(JSON.stringify(result).includes('secret'), false);
});

test('native webhook header update preserves prior headers and never returns their values', async () => {
  const calls = [];
  const client = new GatewayApiClient({
    accessTokenProvider: { getAccessToken: async () => 'test-token' },
    baseUrl: 'https://gateway.example.test/api/v1',
    fetchImpl: async (url, options) => {
      calls.push({ path: url.pathname, method: options.method, body: options.body ? JSON.parse(options.body) : undefined });
      if (options.method === 'POST') return response({ id: 'wh-1', headers: { Authorization: 'old-secret', 'X-Webhook-Key': 'new-secret' } });
      if (url.pathname === '/api/v1/applications') return response([app]);
      if (url.pathname.endsWith('/webhook')) return response({ id: 'wh-1', url: 'https://old.example.test/hook', headers: { Authorization: 'old-secret' } });
      throw new Error(`unexpected GET ${url.pathname}`);
    },
  });
  const prepared = await client.prepareWebhookHeaderUpdate(app.appId, 'X-Webhook-Key');
  assert.doesNotMatch(JSON.stringify(prepared.preview), /old-secret/);
  const result = await client.updateWebhookHeader(prepared, 'new-secret');
  assert.deepEqual(calls.at(-1).body, { headers: { Authorization: 'old-secret', 'X-Webhook-Key': 'new-secret' } });
  assert.doesNotMatch(JSON.stringify(result), /old-secret|new-secret/);
});

test('billing and profile writes use exact panel routes, and api-key deletion never returns its secret', async () => {
  const calls = [];
  const client = new GatewayApiClient({
    accessTokenProvider: { getAccessToken: async () => 'test-token' },
    baseUrl: 'https://gateway.example.test/api/v1',
    fetchImpl: async (url, options) => {
      calls.push({ path: url.pathname, method: options.method, body: options.body ? JSON.parse(options.body) : undefined });
      if (options.method !== 'GET') return response(null, 204);
      if (url.pathname === '/api/v1/applications') return response([app]);
      if (url.pathname.endsWith('/profile')) return response({ about: 'Old about' });
      if (url.pathname.endsWith('/billing/account')) return response({ companyName: 'Old Ltd' });
      if (url.pathname.endsWith('/api-keys')) return response([{ id: '00000000-0000-4000-8000-000000000010', appId: app.appId, name: 'old-key', key: 'sk_secret' }]);
      throw new Error(`unexpected GET ${url.pathname}`);
    },
  });
  await performPanelAction(client, async () => true, 'update_whatsapp_business_profile', { appId: app.appId, profile: { about: 'New about' } });
  await performPanelAction(client, async () => true, 'upsert_billing_account', { account: {
    legalAddress: 'Example street', taxNumber: '123', taxOffice: 'Example', companyName: 'Example Ltd', companyLegalTitle: 'Example Limited', vatNumber: '456',
  } });
  const removed = await performPanelAction(client, async ({ preview }) => {
    assert.doesNotMatch(JSON.stringify(preview), /sk_secret/);
    return true;
  }, 'delete_api_key', { appId: app.appId, keyId: '00000000-0000-4000-8000-000000000010' });
  assert.equal(removed.status, 'applied');
  assert.deepEqual(calls.filter(({ method }) => method !== 'GET').map(({ path, method }) => [path, method]), [
    ['/api/v1/channels/whatsapp/applications/example-app/profile', 'PATCH'],
    ['/api/v1/billing/account', 'PUT'],
    ['/api/v1/applications/example-app/api-keys/00000000-0000-4000-8000-000000000010', 'DELETE'],
  ]);
});

test('API-key creation shows the secret only locally and never returns it to the model', async () => {
  const calls = [];
  const client = new GatewayApiClient({
    accessTokenProvider: { getAccessToken: async () => 'test-token' },
    baseUrl: 'https://gateway.example.test/api/v1',
    fetchImpl: async (url, options) => {
      calls.push({ path: url.pathname, method: options.method, body: options.body ? JSON.parse(options.body) : undefined });
      if (options.method === 'POST') return response({ id: 'key-1', appId: app.appId, name: 'new-key', key: 'sk_super_secret', dailyLimit: 100, concurrencyLimit: 10 });
      if (url.pathname === '/api/v1/applications') return response([app]);
      if (url.pathname === '/api/v1/applications/example-app') return response(app);
      throw new Error(`unexpected GET ${url.pathname}`);
    },
  });
  let displayed = false;
  const result = await createApiKey(client, async () => true, async ({ secret }) => {
    assert.equal(secret, 'sk_super_secret');
    displayed = true;
    return true;
  }, { appId: app.appId, name: 'new-key', dailyLimit: 100, concurrencyLimit: 10 });
  assert.equal(displayed, true);
  assert.equal(result.status, 'created');
  assert.equal(result.metadata.id, 'key-1');
  assert.doesNotMatch(JSON.stringify(result), /sk_super_secret/);
  assert.equal(calls.filter(({ method }) => method === 'POST').length, 1);
  assert.deepEqual(calls.at(-1).body, { name: 'new-key', dailyLimit: 100, concurrencyLimit: 10 });
});

test('organization SECRET creation uses one-time reveal and never returns plaintext to Claude', async () => {
  const calls = [];
  const client = new GatewayApiClient({
    accessTokenProvider: { getAccessToken: async () => 'test-token' },
    baseUrl: 'https://gateway.example.test/api/v1',
    fetchImpl: async (url, options) => {
      calls.push({ path: url.pathname, method: options.method });
      if (url.pathname === '/api/v1/organization-secrets' && options.method === 'GET') return response([]);
      if (url.pathname === '/api/v1/organization-secrets' && options.method === 'POST') return response({ id: 'secret-1', name: 'sdk-secret', type: 'SECRET', status: 'ACTIVE', key: 'sk_••••••' });
      if (url.pathname === '/api/v1/organization-secrets/secret-1/reveal') return response({ id: 'secret-1', key: 'sk_plaintext' });
      throw new Error(`unexpected ${options.method} ${url.pathname}`);
    },
  });
  const result = await createOrganizationSecret(client, async () => true, async ({ secret }) => {
    assert.equal(secret, 'sk_plaintext');
    return true;
  }, { name: 'sdk-secret', type: 'SECRET' });
  assert.equal(result.status, 'created');
  assert.equal(result.secretShownInNativeDialog, true);
  assert.doesNotMatch(JSON.stringify(result), /sk_plaintext|sk_••••••/);
  assert.equal(calls.filter(({ method }) => method === 'POST').length, 2);
});

test('template create and update use the panel POST contracts and do not claim Meta approval', async () => {
  const calls = [];
  const client = new GatewayApiClient({
    accessTokenProvider: { getAccessToken: async () => 'test-token' },
    baseUrl: 'https://gateway.example.test/api/v1',
    fetchImpl: async (url, options) => {
      calls.push({ path: url.pathname, method: options.method, body: options.body ? JSON.parse(options.body) : undefined });
      if (options.method === 'POST') return response({ sourceId: '12345', name: 'hello', language: 'en_US', category: 'UTILITY', status: 'PENDING' });
      if (url.pathname === '/api/v1/applications') return response([app]);
      if (url.pathname.endsWith('/templates/12345')) return response(template);
      throw new Error(`unexpected GET ${url.pathname}`);
    },
  });
  const created = await performPanelAction(client, async () => true, 'create_whatsapp_template', {
    appId: app.appId, template: { name: 'hello', language: 'en_US', category: 'UTILITY', body: { text: 'Hello' } },
  });
  assert.equal(created.status, 'submitted_to_gateway');
  assert.equal(created.approvalByMetaConfirmed, false);
  const updated = await performPanelAction(client, async () => true, 'update_whatsapp_template', {
    appId: app.appId, sourceId: '12345', template: { body: { text: 'Hello again' } },
  });
  assert.equal(updated.status, 'submitted_to_gateway');
  assert.deepEqual(calls.filter(({ method }) => method === 'POST').map(({ path }) => path), [
    '/api/v1/channels/whatsapp/applications/example-app/templates',
    '/api/v1/channels/whatsapp/applications/example-app/templates/12345',
  ]);
});

test('native-picked media upload uses one scoped multipart request, never a chat-supplied path', async () => {
  const filePath = fileURLToPath(new URL('../README.md', import.meta.url));
  const calls = [];
  const client = new GatewayApiClient({
    accessTokenProvider: { getAccessToken: async () => 'test-token' },
    baseUrl: 'https://gateway.example.test/api/v1',
    fetchImpl: async (url, options) => {
      calls.push({ path: url.pathname, method: options.method });
      if (options.method === 'GET') return response([app]);
      assert.equal(url.pathname, '/api/v1/channels/whatsapp/upload');
      assert.equal(options.body.get('appId'), app.appId);
      assert.equal(options.body.get('file').name, 'README.md');
      assert.equal(options.headers['Content-Type'], undefined);
      return response({ handle: 'media-handle-1' });
    },
  });
  const prepared = await client.prepareWhatsappMediaUpload(app.appId, filePath);
  assert.equal(prepared.preview.fileName, 'README.md');
  const uploaded = await client.uploadWhatsappMedia(prepared);
  assert.equal(uploaded.handle, 'media-handle-1');
  assert.equal(calls.filter(({ method }) => method === 'POST').length, 1);
});
