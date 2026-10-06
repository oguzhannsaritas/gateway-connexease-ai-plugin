import assert from 'node:assert/strict';
import test from 'node:test';
import { GatewayApiClient } from '../src/gateway-api.mjs';
import { confirmGatewayAction } from '../src/native-confirm.mjs';
import { sendSandboxTemplate } from '../src/sandbox-workflow.mjs';

const app = { id: '00000000-0000-4000-8000-000000000002', appId: 'example-app', displayName: 'Example App', status: 'ACTIVATED' };
const number = { id: '00000000-0000-4000-8000-000000000001', appId: app.appId, title: 'Test recipient', phoneNumber: '+905551234567' };
const template = {
  id: '00000000-0000-4000-8000-000000000003',
  sourceId: '2721422304922277',
  name: 'iletisim_bilgi_test',
  language: 'tr',
  category: 'UTILITY',
  status: 'APPROVED',
  components: [
    { type: 'BODY', text: 'Merhaba! İletişim bilginize ihtiyacımız var. Aşağıdaki butona dokunun.' },
    { type: 'BUTTONS', buttons: [{ type: 'REQUEST_CONTACT_INFO' }] },
  ],
};

function response(data, status = 200) {
  return new Response(JSON.stringify({ isSuccess: true, data }), { status });
}

function fixture({ detail = template, testNumbers = [number], onPost } = {}) {
  return new GatewayApiClient({
    accessTokenProvider: { getAccessToken: async () => 'test-access-token' },
    baseUrl: 'https://gateway.example.test/api/v1',
    fetchImpl: async (url, options) => {
      if (options.method === 'POST') return onPost(url, options);
      if (url.pathname === '/api/v1/applications') return response([app]);
      if (url.pathname.endsWith('/sandbox/test-numbers')) return response(testNumbers);
      if (url.pathname.endsWith(`/templates/${template.sourceId}`)) return response(typeof detail === 'function' ? detail() : detail);
      throw new Error(`unexpected GET ${url.pathname}`);
    },
  });
}

test('previews and sends the real REQUEST_CONTACT_INFO template with its internal UUID and no fake text body', async () => {
  const posts = [];
  const client = fixture({ onPost: async (url, options) => {
    posts.push({ url: String(url), options });
    return response({ testNumberId: number.id, to: number.phoneNumber, messageType: 'TEMPLATE', messageId: 'wamid.template', elapsedMs: 35 });
  } });
  const args = { appId: app.appId, testNumberId: number.id, sourceId: template.sourceId };
  const prepared = await client.prepareSandboxTemplate(args);
  assert.equal(prepared.status, 'not_sent');
  assert.equal(prepared.preview.template.id, template.id);
  assert.equal(prepared.preview.template.components[1].buttons[0].type, 'REQUEST_CONTACT_INFO');
  assert.deepEqual(prepared.preview.parameters, {});
  assert.equal(posts.length, 0);
  const sent = await client.sendSandboxTemplate(prepared);
  assert.equal(sent.status, 'accepted_by_gateway');
  assert.equal(sent.deliveryConfirmed, false);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].url, 'https://gateway.example.test/api/v1/applications/example-app/sandbox/messages/test');
  assert.deepEqual(JSON.parse(posts[0].options.body), {
    testNumberId: number.id,
    messageType: 'TEMPLATE',
    templateId: template.id,
  });
});

test('blocks unapproved, ID-less, product and carousel templates before any POST', async () => {
  const variants = [
    [{ ...template, status: 'REJECTED' }, /APPROVED/],
    [{ ...template, id: null }, /template\.id/],
    [{ ...template, components: [{ type: 'HEADER', format: 'PRODUCT' }, ...template.components] }, /header format PRODUCT/],
    [{ ...template, components: [{ type: 'CAROUSEL', cards: [] }] }, /component CAROUSEL/],
    [{ ...template, components: [{ type: 'BUTTONS', buttons: [{ type: 'SPM' }] }] }, /button SPM/],
    [{ ...template, components: [{ type: 'BUTTONS', buttons: [{ type: 'MPM' }] }] }, /button MPM/],
  ];
  let posts = 0;
  for (const [detail, pattern] of variants) {
    const client = fixture({ detail, onPost: async () => { posts += 1; return response(null); } });
    await assert.rejects(client.prepareSandboxTemplate({ appId: app.appId, testNumberId: number.id, sourceId: template.sourceId }), pattern);
  }
  assert.equal(posts, 0);
});

test('requires the exact body variables and rejects button parameters for the static contact button', async () => {
  const detail = { ...template, components: [
    { type: 'BODY', text: 'Merhaba {{1}}', example: { bodyText: [['Ahmet']] } },
    { type: 'BUTTONS', buttons: [{ type: 'REQUEST_CONTACT_INFO' }] },
  ] };
  const client = fixture({ detail });
  const args = { appId: app.appId, testNumberId: number.id, sourceId: template.sourceId };
  await assert.rejects(client.prepareSandboxTemplate(args), /body requires 1 value/);
  const prepared = await client.prepareSandboxTemplate({ ...args, parameters: { body: ['Ahmet'] } });
  assert.deepEqual(prepared.preview.parameters, { body: ['Ahmet'] });
  await assert.rejects(client.prepareSandboxTemplate({ ...args, parameters: {
    body: ['Ahmet'], buttons: [{ index: 0, subType: 'URL', value: 'bad' }],
  } }), /Static button 0/);
});

test('rejects a test number from another application before a template POST', async () => {
  let posts = 0;
  const client = fixture({
    testNumbers: [{ ...number, appId: 'other-app' }],
    onPost: async () => { posts += 1; return response(null); },
  });
  await assert.rejects(client.prepareSandboxTemplate({
    appId: app.appId, testNumberId: number.id, sourceId: template.sourceId,
  }), /not found in this application/);
  assert.equal(posts, 0);
});

test('blocks a changed template or recipient after approval and before POST', async () => {
  let detailReads = 0;
  let posts = 0;
  const client = fixture({
    detail: () => ({ ...template, name: ++detailReads === 1 ? template.name : 'changed_template' }),
    onPost: async () => { posts += 1; return response(null); },
  });
  const prepared = await client.prepareSandboxTemplate({ appId: app.appId, testNumberId: number.id, sourceId: template.sourceId });
  await assert.rejects(client.sendSandboxTemplate(prepared), /template or recipient changed/);
  assert.equal(posts, 0);
});

test('a template send needs native approval; cancellation makes no POST', async () => {
  const calls = [];
  const gateway = {
    prepareSandboxTemplate: async () => { calls.push('prepare'); return { status: 'not_sent', preview: {
      applicationId: app.appId, phoneNumber: number.phoneNumber, testNumber: number.title,
      template, parameters: {},
    } }; },
    sendSandboxTemplate: async () => { calls.push('send'); return { status: 'accepted_by_gateway' }; },
  };
  assert.deepEqual(await sendSandboxTemplate(gateway, async () => false, {}), { status: 'cancelled', sent: false });
  assert.deepEqual(calls, ['prepare']);
  const confirmed = await confirmGatewayAction({ kind: 'send_sandbox_template', preview: {
    applicationId: app.appId, phoneNumber: number.phoneNumber, testNumber: number.title,
    template, parameters: {},
  } }, { execute: async (payload) => {
    assert.match(payload.prompt, /REAL sandbox WhatsApp TEMPLATE/);
    assert.match(payload.value, /REQUEST_CONTACT_INFO/);
    return true;
  } });
  assert.equal(confirmed, true);
  assert.equal((await sendSandboxTemplate(gateway, async () => true, {})).status, 'accepted_by_gateway');
  assert.deepEqual(calls, ['prepare', 'prepare', 'send']);
});

test('a template send with an uncertain response makes one POST and does not report delivery', async () => {
  let posts = 0;
  const client = fixture({ onPost: async () => {
    posts += 1;
    throw new Error('network failed after send');
  } });
  const prepared = await client.prepareSandboxTemplate({
    appId: app.appId, testNumberId: number.id, sourceId: template.sourceId,
  });
  await assert.rejects(client.sendSandboxTemplate(prepared), /outcome is unknown/);
  assert.equal(posts, 1);
});
