import { spawn } from 'node:child_process';
import { DEFAULT_API_BASE_URL } from './gateway-api.mjs';

const KEYCHAIN_SERVICE = 'com.connexease.gateway-ai-ops.refresh';
const KEYCHAIN_ACCOUNT = 'default';

function runSecurity(args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/security', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.on('error', () => reject(new Error('macOS Keychain is unavailable')));
    child.on('close', (code) => {
      if (code === 0) resolve(output.trim());
      else reject(new Error('macOS Keychain operation failed'));
    });
    child.stdin.end(input === undefined ? undefined : `${input}\n`);
  });
}

/** The refresh token is stored outside the plugin, in the current user's Keychain. */
export class MacKeychainStore {
  constructor({ execute = runSecurity } = {}) {
    if (process.platform !== 'darwin' && execute === runSecurity) {
      throw new Error('Local sign-in currently supports macOS Keychain only');
    }
    this.execute = execute;
  }

  async getRefreshToken() {
    try {
      return await this.execute([
        'find-generic-password', '-a', KEYCHAIN_ACCOUNT, '-s', KEYCHAIN_SERVICE, '-w',
      ]);
    } catch {
      throw new Error('Gateway login required. Run npm run login in a terminal.');
    }
  }

  async setRefreshToken(token) {
    if (typeof token !== 'string' || !token) throw new Error('Missing Gateway refresh token');
    // A bare trailing -w asks security to read the secret from stdin. Never put
    // credentials in argv, environment variables, stdout, or project files.
    await this.execute([
      'add-generic-password', '-a', KEYCHAIN_ACCOUNT, '-s', KEYCHAIN_SERVICE, '-U', '-w',
    ], token);
  }
}

async function postAuth(path, body, fetchImpl, baseUrl) {
  const endpoint = new URL(baseUrl);
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error('Gateway authentication URL must be a clean HTTPS URL');
  }
  const url = new URL(`${baseUrl}${path}`);
  if (url.origin !== endpoint.origin) throw new Error('Invalid Gateway authentication URL');
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Client-Type': 'native',
      },
      body: JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new Error('Gateway authentication endpoint is unreachable');
  }
  if (!response.ok) throw new Error(`Gateway authentication failed (HTTP ${response.status})`);
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error('Gateway returned an invalid authentication response');
  }
  const data = payload?.data;
  if (payload.isSuccess === false || typeof data?.accessToken !== 'string' || typeof data?.refreshToken !== 'string') {
    throw new Error('Gateway returned an invalid authentication response');
  }
  return data;
}

/** Called only by the separate human-operated terminal command, never by MCP. */
export async function loginWithPassword({ email, password, fetchImpl = fetch, baseUrl = DEFAULT_API_BASE_URL }) {
  if (typeof email !== 'string' || !email.includes('@') || typeof password !== 'string' || !password) {
    throw new Error('Email and password are required');
  }
  const session = await postAuth('/auth/token', { email, password }, fetchImpl, baseUrl);
  return {
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    expiresIn: session.expiresIn,
  };
}

export class NativeSession {
  #accessToken = null;
  #expiresAt = 0;
  #refreshInFlight = null;

  constructor({ store = new MacKeychainStore(), fetchImpl = fetch, baseUrl = DEFAULT_API_BASE_URL } = {}) {
    this.store = store;
    this.fetchImpl = fetchImpl;
    this.baseUrl = baseUrl;
  }

  async getAccessToken() {
    if (this.#accessToken && Date.now() < this.#expiresAt - 60_000) return this.#accessToken;
    if (!this.#refreshInFlight) {
      this.#refreshInFlight = this.#refresh().finally(() => { this.#refreshInFlight = null; });
    }
    return this.#refreshInFlight;
  }

  async #refresh() {
    const refreshToken = await this.store.getRefreshToken();
    const session = await postAuth('/auth/refresh', { refreshToken }, this.fetchImpl, this.baseUrl);
    await this.store.setRefreshToken(session.refreshToken);
    this.#accessToken = session.accessToken;
    this.#expiresAt = Date.now() + Math.max(0, Number(session.expiresIn) || 0) * 1000;
    return this.#accessToken;
  }
}
