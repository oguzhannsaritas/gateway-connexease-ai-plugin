import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import test from 'node:test';
import { loginWithPassword, MacKeychainStore, NativeSession, promptForGatewayCredentials, runSecurity } from '../src/native-session.mjs';

const baseUrl = 'https://gateway.example.test/api/v1';

test('native login calls the existing core endpoint without exposing credentials in errors', async () => {
  const calls = [];
  const result = await loginWithPassword({
    email: 'dev@example.test', password: 'sample-password', baseUrl,
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return new Response(JSON.stringify({ isSuccess: true, data: {
        accessToken: 'access-1', refreshToken: 'refresh-1', expiresIn: 3600,
      } }), { status: 200 });
    },
  });
  assert.equal(result.accessToken, 'access-1');
  assert.equal(result.refreshToken, 'refresh-1');
  assert.equal(calls[0].url, 'https://gateway.example.test/api/v1/auth/token');
  assert.equal(calls[0].options.headers['X-Client-Type'], 'native');
  assert.deepEqual(JSON.parse(calls[0].options.body), { email: 'dev@example.test', password: 'sample-password' });
  assert.equal(calls[0].options.redirect, 'error');
});

test('rejects non-HTTPS authentication URL', async () => {
  await assert.rejects(loginWithPassword({
    email: 'dev@example.test', password: 'password', baseUrl: 'http://gateway.example.test/api/v1',
  }), /HTTPS/);
});

test('refreshes once and rotates the Keychain token before returning access', async () => {
  const saved = [];
  const store = {
    getRefreshToken: async () => 'refresh-1',
    setRefreshToken: async (token) => { saved.push(token); },
  };
  let calls = 0;
  const session = new NativeSession({
    store, baseUrl,
    fetchImpl: async (url, options) => {
      calls += 1;
      assert.equal(String(url), 'https://gateway.example.test/api/v1/auth/refresh');
      assert.deepEqual(JSON.parse(options.body), { refreshToken: 'refresh-1' });
      return new Response(JSON.stringify({ isSuccess: true, data: {
        accessToken: 'access-2', refreshToken: 'refresh-2', expiresIn: 3600,
      } }), { status: 200 });
    },
  });
  const [first, second] = await Promise.all([session.getAccessToken(), session.getAccessToken()]);
  assert.equal(first, 'access-2');
  assert.equal(second, 'access-2');
  assert.deepEqual(saved, ['refresh-2']);
  assert.equal(calls, 1);
  assert.equal(await session.getAccessToken(), 'access-2');
  assert.equal(calls, 1);
});

test('Keychain write sends secret on stdin, never in process arguments', async () => {
  let commandArgs;
  let secretInput;
  const store = new MacKeychainStore({ execute: async (args, input) => {
    commandArgs = args;
    secretInput = input;
  } });
  await store.setRefreshToken('refresh-secret');
  assert.equal(commandArgs.at(-1), '-w');
  assert.equal(commandArgs.includes('refresh-secret'), false);
  assert.equal(secretInput, 'refresh-secret');
});

test('Keychain write uses a silent pseudo-terminal helper without exposing token in argv', async () => {
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
      final(done) { queueMicrotask(() => { child.stdout.write('refresh-secret'); child.emit('close', 0); }); done(); },
    });
    return child;
  };
  const output = await runSecurity(['add-generic-password', '-a', 'default', '-s', 'test-service', '-U', '-w'], 'refresh-secret', spawnImpl);
  assert.equal(command, '/usr/bin/expect');
  assert.match(args[0], /keychain-write\.exp$/);
  assert.equal(args.includes('refresh-secret'), false);
  assert.equal(input, 'refresh-secret\n');
  assert.equal(output, '');
});

test('native dialogs collect credentials without including them in script arguments', async () => {
  const scripts = [];
  const credentials = await promptForGatewayCredentials({ execute: async (script) => {
    scripts.push(script);
    return scripts.length === 1 ? 'dev@example.test' : 'private-password';
  } });
  assert.deepEqual(credentials, { email: 'dev@example.test', password: 'private-password' });
  assert.match(scripts[1], /hiddenAnswer: true/);
  assert.doesNotMatch(scripts.join(' '), /dev@example\.test|private-password/);
});

test('in-session connection verifies the profile, saves refresh token, and uses new access token', async () => {
  const saved = [];
  const calls = [];
  const session = new NativeSession({
    baseUrl,
    store: { setRefreshToken: async (token) => { saved.push(token); }, getRefreshToken: async () => { throw new Error('should not refresh'); } },
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      if (url.pathname.endsWith('/auth/token')) return new Response(JSON.stringify({ isSuccess: true, data: {
        accessToken: 'new-access', refreshToken: 'new-refresh', expiresIn: 3600,
      } }), { status: 200 });
      if (url.pathname.endsWith('/users/me')) return new Response(JSON.stringify({ isSuccess: true, data: {
        id: 'user-1', email: 'dev@example.test', state: 'ACTIVE',
      } }), { status: 200 });
      throw new Error('unexpected request');
    },
  });
  const profile = await session.connectWithCredentials({ email: 'dev@example.test', password: 'private-password' });
  assert.deepEqual(profile, { id: 'user-1', email: 'dev@example.test', state: 'ACTIVE', sessionPersistence: 'keychain' });
  assert.deepEqual(saved, ['new-refresh']);
  assert.equal(await session.getAccessToken(), 'new-access');
  assert.equal(calls.length, 2);
  assert.equal(calls[1].options.headers.Authorization, 'Bearer new-access');
});

test('failed profile verification never persists refresh token', async () => {
  let writes = 0;
  const session = new NativeSession({
    baseUrl,
    store: { setRefreshToken: async () => { writes += 1; } },
    fetchImpl: async (url) => url.pathname.endsWith('/auth/token')
      ? new Response(JSON.stringify({ isSuccess: true, data: { accessToken: 'access', refreshToken: 'refresh', expiresIn: 3600 } }), { status: 200 })
      : new Response(JSON.stringify({ isSuccess: false }), { status: 401 }),
  });
  await assert.rejects(session.connectWithCredentials({ email: 'dev@example.test', password: 'private-password' }), /session expired/);
  assert.equal(writes, 0);
});

test('Keychain failure keeps the verified account usable in memory, including token refresh', async () => {
  const calls = [];
  const session = new NativeSession({
    baseUrl,
    store: {
      getRefreshToken: async () => { throw new Error('must use in-memory token'); },
      setRefreshToken: async () => { throw new Error('Keychain unavailable'); },
    },
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      if (url.pathname.endsWith('/auth/token')) return new Response(JSON.stringify({ isSuccess: true, data: {
        accessToken: 'access-1', refreshToken: 'refresh-1', expiresIn: 0,
      } }), { status: 200 });
      if (url.pathname.endsWith('/users/me')) return new Response(JSON.stringify({ isSuccess: true, data: {
        id: 'user-1', email: 'dev@example.test', state: 'ACTIVE',
      } }), { status: 200 });
      if (url.pathname.endsWith('/auth/refresh')) return new Response(JSON.stringify({ isSuccess: true, data: {
        accessToken: 'access-2', refreshToken: 'refresh-2', expiresIn: 3600,
      } }), { status: 200 });
      throw new Error('unexpected request');
    },
  });
  const profile = await session.connectWithCredentials({ email: 'dev@example.test', password: 'private-password' });
  assert.equal(profile.sessionPersistence, 'memory_only');
  assert.equal(await session.getAccessToken(), 'access-2');
  assert.deepEqual(JSON.parse(calls[2].options.body), { refreshToken: 'refresh-1' });
});
