import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DEFAULT_API_BASE_URL, GatewayApiClient } from './gateway-api.mjs';

const KEYCHAIN_SERVICE = 'com.connexease.gateway-ai-ops.refresh';
const KEYCHAIN_ACCOUNT = 'default';
const KEYCHAIN_WRITE_HELPER = fileURLToPath(new URL('../scripts/keychain-write.exp', import.meta.url));

const EMAIL_DIALOG = 'var app = Application.currentApplication(); app.includeStandardAdditions = true; app.displayDialog("Connexease Gateway email address", {defaultAnswer: "", buttons: ["Cancel", "Next"], defaultButton: "Next"}).textReturned';
const PASSWORD_DIALOG = 'var app = Application.currentApplication(); app.includeStandardAdditions = true; app.displayDialog("Connexease Gateway password", {defaultAnswer: "", buttons: ["Cancel", "Connect"], defaultButton: "Connect", hiddenAnswer: true}).textReturned';

function runAppleScript(script) {
  return new Promise((resolve, reject) => {
    // The script contains no credentials. Dialog answers travel only through
    // this child's stdout pipe and are never returned to the MCP client.
    const child = spawn('/usr/bin/osascript', ['-l', 'JavaScript', '-e', script], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.resume();
    child.on('error', () => reject(new Error('macOS sign-in dialog is unavailable')));
    child.on('close', (code) => {
      if (code === 0) resolve(output.replace(/\r?\n$/, ''));
      else reject(new Error('Gateway sign-in cancelled or macOS dialog unavailable'));
    });
  });
}

/** Credentials are collected by macOS dialogs, not by an AI chat message. */
export async function promptForGatewayCredentials({ execute = runAppleScript } = {}) {
  if (process.platform !== 'darwin' && execute === runAppleScript) {
    throw new Error('In-session sign-in currently supports macOS only');
  }
  const email = (await execute(EMAIL_DIALOG)).trim();
  if (!email.includes('@')) throw new Error('A valid Gateway email address is required');
  const password = await execute(PASSWORD_DIALOG);
  if (!password) throw new Error('Gateway password is required');
  return { email, password };
}

export function runSecurity(args, input, spawnImpl = spawn) {
  return new Promise((resolve, reject) => {
    const isWrite = input !== undefined;
    if (isWrite && args.at(-1) !== '-w') {
      reject(new Error('Invalid Keychain write command'));
      return;
    }
    // security(1) reads a bare -w prompt from a TTY, not a stdin pipe.
    // Expect supplies that TTY without putting the token in argv or a file.
    const child = isWrite
      ? spawnImpl('/usr/bin/expect', [KEYCHAIN_WRITE_HELPER, KEYCHAIN_ACCOUNT, KEYCHAIN_SERVICE], { stdio: ['pipe', 'pipe', 'pipe'] })
      : spawnImpl('/usr/bin/security', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { if (!isWrite) output += chunk; });
    child.stderr.resume();
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
      throw new Error('Gateway login required. Run /connexease-gateway-ops:connect in Claude Code.');
    }
  }

  async setRefreshToken(token) {
    if (typeof token !== 'string' || !token || /[\r\n\0]/.test(token)) throw new Error('Invalid Gateway refresh token');
    // The helper answers security's TTY prompt. The token never appears in
    // process arguments, environment variables, stdout, or project files.
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

/** Called by a native, human-operated prompt; never accepts MCP tool arguments. */
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

  async connectWithCredentials({ email, password }) {
    const session = await loginWithPassword({ email, password, fetchImpl: this.fetchImpl, baseUrl: this.baseUrl });
    const gateway = new GatewayApiClient({
      accessTokenProvider: { getAccessToken: async () => session.accessToken },
      fetchImpl: this.fetchImpl,
      baseUrl: this.baseUrl,
    });
    const profile = await gateway.getMyProfile();
    await this.store.setRefreshToken(session.refreshToken);
    this.#accessToken = session.accessToken;
    this.#expiresAt = Date.now() + Math.max(0, Number(session.expiresIn) || 0) * 1000;
    return profile;
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
