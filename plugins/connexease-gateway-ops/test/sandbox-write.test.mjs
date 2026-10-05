import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import test from 'node:test';
import { GatewayApiClient } from '../src/gateway-api.mjs';
import { confirmGatewayAction, runNativeConfirmation } from '../src/native-confirm.mjs';
import { addSandboxTestNumber, sendSandboxText } from '../src/sandbox-workflow.mjs';

const app = { id: '00000000-0000-4000-8000-000000000002', appId: 'example-app', displayName: 'Example App', status: 'ACTIVATED' };
const number = { id: '00000000-0000-4000-8000-000000000001', appId: app.appId, title: 'My phone', phoneNumber: '+905551234567' };

function response(data, status = 200) {
  return new Response(JSON.stringify({ isSuccess: true, data }), { status });
}

function fixture(fetchImpl) {
  return new GatewayApiClient({
    accessTokenProvider: { getAccessToken: async () => 'test-access-token' },
    baseUrl: 'https://gateway.example.test/api/v1',
    fetchImpl,
  });
}

test('adds a valid test number only after preparation and uses the panel POST contract', async () => {
  const posts = [];
  const client = fixture(async (url, options) => {
    if (options.method === 'GET' && url.pathname === '/api/v1/applications') return response([app]);
    if (options.method === 'GET' && url.pathname.endsWith('/sandbox/test-numbers')) return response([]);
    if (options.method === 'POST') {
      posts.push({ path: url.pathname, options });
      return response(number, 201);
    }
    throw new Error('unexpected request');
  });
  const prepared = await client.prepareSandboxTestNumber({ appId: app.appId, phoneNumber: '905551234567', title: 'My phone' });
  assert.equal(prepared.status, 'ready');
  assert.equal(prepared.preview.phoneNumber, number.phoneNumber);
  assert.equal(posts.length, 0);
  const created = await client.createSandboxTestNumber(prepared);
  assert.equal(created.status, 'created');
  assert.deepEqual(created.number, number);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].path, '/api/v1/applications/example-app/sandbox/test-numbers');
  assert.deepEqual(JSON.parse(posts[0].options.body), { phoneNumber: number.phoneNumber, title: 'My phone' });
  assert.equal(posts[0].options.headers.Authorization, 'Bearer test-access-token');
  assert.equal(posts[0].options.redirect, 'error');
});

test('does not add a duplicate or malformed test number', async () => {
  let posts = 0;
  const client = fixture(async (url, options) => {
    if (options.method === 'POST') posts += 1;
    if (url.pathname === '/api/v1/applications') return response([app]);
    return response([number]);
  });
  const existing = await client.prepareSandboxTestNumber({ appId: app.appId, phoneNumber: number.phoneNumber });
  assert.equal(existing.status, 'already_exists');
  await assert.rejects(client.prepareSandboxTestNumber({ appId: app.appId, phoneNumber: '123' }), /E\.164/);
  assert.equal(posts, 0);
});

test('sends one custom sandbox text to a number in the selected application', async () => {
  const posts = [];
  const client = fixture(async (url, options) => {
    if (options.method === 'GET' && url.pathname === '/api/v1/applications') return response([app]);
    if (options.method === 'GET' && url.pathname.endsWith('/sandbox/test-numbers')) return response([number]);
    if (options.method === 'POST') {
      posts.push({ path: url.pathname, options });
      return response({ testNumberId: number.id, to: number.phoneNumber, messageType: 'CUSTOM', messageId: 'wamid.test', elapsedMs: 42 });
    }
    throw new Error('unexpected request');
  });
  const prepared = await client.prepareSandboxText({ appId: app.appId, testNumberId: number.id, message: 'Hello sandbox' });
  assert.equal(posts.length, 0);
  const sent = await client.sendSandboxText(prepared);
  assert.equal(sent.status, 'accepted_by_gateway');
  assert.equal(sent.deliveryConfirmed, false);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].path, '/api/v1/applications/example-app/sandbox/messages/test');
  assert.deepEqual(JSON.parse(posts[0].options.body), {
    testNumberId: number.id, messageType: 'CUSTOM', message: 'Hello sandbox',
  });
});

test('rejects a number belonging to another application before POST', async () => {
  let posts = 0;
  const client = fixture(async (url, options) => {
    if (options.method === 'POST') posts += 1;
    if (url.pathname === '/api/v1/applications') return response([app]);
    return response([{ ...number, appId: 'another-app' }]);
  });
  await assert.rejects(client.prepareSandboxText({ appId: app.appId, testNumberId: number.id, message: 'Hello' }), /not found in this application/);
  assert.equal(posts, 0);
});

test('rechecks the confirmed recipient and never sends after it changes', async () => {
  let listReads = 0;
  let posts = 0;
  const client = fixture(async (url, options) => {
    if (options.method === 'POST') posts += 1;
    if (url.pathname === '/api/v1/applications') return response([app]);
    listReads += 1;
    return response([{ ...number, phoneNumber: listReads === 1 ? number.phoneNumber : '+905551234568' }]);
  });
  const prepared = await client.prepareSandboxText({ appId: app.appId, testNumberId: number.id, message: 'Hello' });
  await assert.rejects(client.sendSandboxText(prepared), /recipient changed/);
  assert.equal(posts, 0);
});

test('an uncertain send makes one attempt and tells the user not to retry blindly', async () => {
  let posts = 0;
  const client = fixture(async (url, options) => {
    if (options.method === 'GET' && url.pathname === '/api/v1/applications') return response([app]);
    if (options.method === 'GET') return response([number]);
    posts += 1;
    throw new Error('connection dropped after request');
  });
  const prepared = await client.prepareSandboxText({ appId: app.appId, testNumberId: number.id, message: 'Hello' });
  await assert.rejects(client.sendSandboxText(prepared), /outcome is unknown.*before retrying/);
  assert.equal(posts, 1);
});

test('a server error after a send attempt is also treated as an unknown outcome', async () => {
  let posts = 0;
  const client = fixture(async (url, options) => {
    if (options.method === 'GET' && url.pathname === '/api/v1/applications') return response([app]);
    if (options.method === 'GET') return response([number]);
    posts += 1;
    return response(null, 502);
  });
  const prepared = await client.prepareSandboxText({ appId: app.appId, testNumberId: number.id, message: 'Hello' });
  await assert.rejects(client.sendSandboxText(prepared), /outcome is unknown.*before retrying/);
  assert.equal(posts, 1);
});

test('cancelled native confirmation never creates a number or sends a message', async () => {
  const calls = [];
  const gateway = {
    prepareSandboxTestNumber: async () => ({ status: 'ready', preview: { applicationId: app.appId, phoneNumber: number.phoneNumber } }),
    createSandboxTestNumber: async () => { calls.push('create'); },
    prepareSandboxText: async () => ({ status: 'not_sent', preview: { applicationId: app.appId, testNumberId: number.id, phoneNumber: number.phoneNumber, message: 'Hello' } }),
    sendSandboxText: async () => { calls.push('send'); },
  };
  assert.deepEqual(await addSandboxTestNumber(gateway, async () => false, {}), { status: 'cancelled', changed: false });
  assert.deepEqual(await sendSandboxText(gateway, async () => false, {}), { status: 'cancelled', sent: false });
  assert.deepEqual(calls, []);
});

test('confirmed workflows write only after the matching preview has been approved', async () => {
  const order = [];
  const numberPreview = { applicationId: app.appId, phoneNumber: number.phoneNumber };
  const textPreview = { applicationId: app.appId, testNumberId: number.id, phoneNumber: number.phoneNumber, message: 'Hello' };
  const gateway = {
    prepareSandboxTestNumber: async () => { order.push('prepare-number'); return { status: 'ready', preview: numberPreview }; },
    createSandboxTestNumber: async (prepared) => { order.push('create'); assert.deepEqual(prepared.preview, numberPreview); return { status: 'created' }; },
    prepareSandboxText: async () => { order.push('prepare-text'); return { status: 'not_sent', preview: textPreview }; },
    sendSandboxText: async (prepared) => { order.push('send'); assert.deepEqual(prepared.preview, textPreview); return { status: 'accepted_by_gateway' }; },
  };
  const confirm = async (action) => { order.push(`confirm-${action.kind}`); return true; };
  assert.equal((await addSandboxTestNumber(gateway, confirm, {})).status, 'created');
  assert.equal((await sendSandboxText(gateway, confirm, {})).status, 'accepted_by_gateway');
  assert.deepEqual(order, [
    'prepare-number', 'confirm-add_test_number', 'create',
    'prepare-text', 'confirm-send_sandbox_text', 'send',
  ]);
});

test('native confirmation keeps action details out of process arguments', async () => {
  let command;
  let args;
  let input = '';
  const spawnImpl = (name, commandArgs) => {
    command = name;
    args = commandArgs;
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new Writable({
      write(chunk, _encoding, done) { input += chunk.toString(); done(); },
      final(done) { queueMicrotask(() => { child.stdout.write('CONFIRMED\n'); child.emit('close', 0); }); done(); },
    });
    return child;
  };
  const payload = { prompt: 'Real send?', value: 'private message', approveLabel: 'Send' };
  assert.equal(await runNativeConfirmation(payload, spawnImpl), true);
  assert.equal(command, '/usr/bin/osascript');
  assert.equal(args.includes('private message'), false);
  assert.deepEqual(JSON.parse(input), payload);
  assert.equal(await confirmGatewayAction({ kind: 'send_sandbox_text', preview: {
    applicationId: app.appId, phoneNumber: number.phoneNumber, testNumber: number.title, message: 'Hello',
  } }, { execute: async (details) => {
    assert.match(details.prompt, /ONE REAL sandbox WhatsApp message/);
    assert.equal(details.value, 'Hello');
    return true;
  } }), true);
});
