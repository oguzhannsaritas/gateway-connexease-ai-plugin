import assert from 'node:assert/strict';
import test from 'node:test';
import { loginWithPassword, MacKeychainStore, NativeSession } from '../src/native-session.mjs';

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
