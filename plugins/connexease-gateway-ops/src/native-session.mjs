import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DEFAULT_API_BASE_URL, GatewayApiClient } from './gateway-api.mjs';

const KEYCHAIN_SERVICE = 'com.connexease.gateway-ai-ops.refresh';
const KEYCHAIN_ACCOUNT = 'default';
const KEYCHAIN_WRITE_HELPER = fileURLToPath(new URL('../scripts/keychain-write.exp', import.meta.url));

const EMAIL_DIALOG = 'var app = Application.currentApplication(); app.includeStandardAdditions = true; app.displayDialog("Connexease Gateway email address", {defaultAnswer: "", buttons: ["Cancel", "Next"], defaultButton: "Next"}).textReturned';
const PASSWORD_DIALOG = 'var app = Application.currentApplication(); app.includeStandardAdditions = true; app.displayDialog("Connexease Gateway password", {defaultAnswer: "", buttons: ["Cancel", "Connect"], defaultButton: "Connect", hiddenAnswer: true}).textReturned';

function nativeAnswerPrompt(label, hidden = false) {
  return `var app = Application.currentApplication(); app.includeStandardAdditions = true; app.displayDialog(${JSON.stringify(label)}, {defaultAnswer: "", buttons: ["Cancel", "Next"], defaultButton: "Next"${hidden ? ', hiddenAnswer: true' : ''}}).textReturned`;
}

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

export async function promptForGatewayRegistration({ execute = runAppleScript } = {}) {
  if (process.platform !== 'darwin' && execute === runAppleScript) throw new Error('Native registration currently supports macOS only');
  const firstName = (await execute(nativeAnswerPrompt('Gateway registration: first name'))).trim();
  const lastName = (await execute(nativeAnswerPrompt('Gateway registration: last name'))).trim();
  const email = (await execute(nativeAnswerPrompt('Gateway registration: email'))).trim();
  const password = await execute(nativeAnswerPrompt('Gateway registration: password', true));
  const confirmation = await execute(nativeAnswerPrompt('Gateway registration: confirm password', true));
  if (!firstName || !lastName || !email.includes('@') || !password || password !== confirmation) throw new Error('Registration details are incomplete or passwords do not match');
  return { firstName, lastName, email, password };
}

export async function promptForPasswordChange({ execute = runAppleScript } = {}) {
  if (process.platform !== 'darwin' && execute === runAppleScript) throw new Error('Native password change currently supports macOS only');
  const currentPassword = await execute(nativeAnswerPrompt('Gateway current password', true));
  const newPassword = await execute(nativeAnswerPrompt('Gateway new password', true));
  const confirmPassword = await execute(nativeAnswerPrompt('Confirm Gateway new password', true));
  if (!currentPassword || !newPassword || newPassword !== confirmPassword) throw new Error('Password details are incomplete or do not match');
  return { currentPassword, newPassword, confirmPassword };
}

export async function promptForGatewayOtp({ execute = runAppleScript } = {}) {
  if (process.platform !== 'darwin' && execute === runAppleScript) throw new Error('Native verification currently supports macOS only');
  const code = (await execute(nativeAnswerPrompt('Gateway verification code', true))).trim();
  if (!/^\d{4,10}$/.test(code)) throw new Error('Gateway verification code is invalid');
  return code;
}

export async function promptForNewPassword({ execute = runAppleScript } = {}) {
  if (process.platform !== 'darwin' && execute === runAppleScript) throw new Error('Native password reset currently supports macOS only');
  const newPassword = await execute(nativeAnswerPrompt('Gateway new password', true));
  const confirmPassword = await execute(nativeAnswerPrompt('Confirm Gateway new password', true));
  if (!newPassword || newPassword !== confirmPassword) throw new Error('New passwords do not match');
  return { newPassword, confirmPassword };
}

export async function promptForWebhookHeaderValue({ execute = runAppleScript } = {}) {
  if (process.platform !== 'darwin' && execute === runAppleScript) throw new Error('Native webhook header entry currently supports macOS only');
  const value = await execute(nativeAnswerPrompt('Gateway webhook header value', true));
  if (!value || value.length > 4096 || /[\r\n\0]/.test(value)) throw new Error('Webhook header value must be 1-4096 characters without line breaks');
  return value;
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
      else {
        const error = new Error('macOS Keychain operation failed');
        error.exitCode = code;
        reject(error);
      }
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
      throw new Error('Gateway login required. Use the connect skill or call connect_gateway_account in this local AI client.');
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

  async deleteRefreshToken() {
    try {
      await this.execute(['delete-generic-password', '-a', KEYCHAIN_ACCOUNT, '-s', KEYCHAIN_SERVICE]);
    } catch (error) {
      if (error?.exitCode === 44) return;
      // A missing item is already signed out; any other error leaves the
      // previous refresh token's state uncertain.
      throw new Error('Could not clear the Gateway session from macOS Keychain');
    }
  }
}

async function postAuthData(path, body, fetchImpl, baseUrl, accessToken) {
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
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new Error('Gateway authentication endpoint is unreachable');
  }
  if (!response.ok) throw new Error(`Gateway authentication failed (HTTP ${response.status})`);
  if (response.status === 204) return null;
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error('Gateway returned an invalid authentication response');
  }
  if (payload?.isSuccess === false || !payload || typeof payload !== 'object') {
    throw new Error('Gateway returned an invalid authentication response');
  }
  return payload.data ?? null;
}

async function postAuth(path, body, fetchImpl, baseUrl, accessToken) {
  const data = await postAuthData(path, body, fetchImpl, baseUrl, accessToken);
  if (typeof data?.accessToken !== 'string' || typeof data?.refreshToken !== 'string') {
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
  #memoryRefreshToken = null;
  #sessionPersistence = 'memory_only';
  #passwordResetTarget = null;
  #passwordResetToken = null;
  #signedOut = false;

  constructor({ store = new MacKeychainStore(), fetchImpl = fetch, baseUrl = DEFAULT_API_BASE_URL } = {}) {
    this.store = store;
    this.fetchImpl = fetchImpl;
    this.baseUrl = baseUrl;
  }

  async connectWithCredentials({ email, password }) {
    const session = await loginWithPassword({ email, password, fetchImpl: this.fetchImpl, baseUrl: this.baseUrl });
    return this.#adoptSession(session);
  }

  async disconnect() {
    let token = this.#accessToken;
    if (!token) {
      try { token = await this.getAccessToken(); } catch { /* No usable session. */ }
    }
    let refreshToken = this.#memoryRefreshToken;
    if (!refreshToken) {
      try { refreshToken = await this.store.getRefreshToken(); } catch { /* No saved refresh token. */ }
    }
    this.#accessToken = null;
    this.#expiresAt = 0;
    this.#memoryRefreshToken = null;
    this.#passwordResetTarget = null;
    this.#passwordResetToken = null;
    this.#signedOut = true;
    let keychainCleared = false;
    try {
      await this.store.deleteRefreshToken();
      keychainCleared = true;
    } catch {
      // Never claim logout succeeded when a refresh token may remain locally.
    }
    let gatewayRevoked = false;
    if (token) {
      try {
        await postAuthData('/auth/logout', refreshToken ? { refreshToken } : {}, this.fetchImpl, this.baseUrl, token);
        gatewayRevoked = true;
      } catch {
        // Local state remains cleared, but the remote session may still live.
      }
    }
    return {
      status: keychainCleared ? 'disconnected' : 'keychain_cleanup_failed',
      keychainCleared,
      gatewayRevoked,
      ...(keychainCleared ? {} : { warning: 'A saved Gateway refresh token may remain in macOS Keychain. Remove it manually before closing this session.' }),
    };
  }

  async registerWithCredentials(registration) {
    const session = await postAuth('/users/register', registration, this.fetchImpl, this.baseUrl);
    try { return await this.#adoptSession(session); }
    catch { throw new Error('Gateway account may have been created, but session verification failed. Check the account before registering again.'); }
  }

  async changePassword(credentials) {
    const accessToken = await this.getAccessToken();
    const session = await postAuth('/auth/password/change', credentials, this.fetchImpl, this.baseUrl, accessToken);
    try { return await this.#adoptSession(session); }
    catch { throw new Error('Gateway password may have changed, but session verification failed. Check the account before retrying.'); }
  }

  async assignOrganization(details) {
    const session = await postAuth('/auth/organizations/assign', details, this.fetchImpl, this.baseUrl, await this.getAccessToken());
    try { return await this.#adoptSession(session); }
    catch { throw new Error('Gateway organization may have been assigned, but session verification failed. Check the account before retrying.'); }
  }

  async startPasswordReset(target) {
    if (typeof target !== 'string' || !/^\+[1-9]\d{6,14}$/.test(target)) throw new Error('Phone number must be E.164');
    await postAuthData('/auth/two-factor/send', { verificationSource: 'WHATSAPP', target, type: 'FORGET_PASSWORD' }, this.fetchImpl, this.baseUrl);
    this.#passwordResetTarget = target;
    this.#passwordResetToken = null;
    return { status: 'code_requested', target };
  }

  async verifyPasswordResetCode(code) {
    if (!this.#passwordResetTarget) throw new Error('Start password reset in this AI client session first');
    if (typeof code !== 'string' || !/^\d{4,10}$/.test(code)) throw new Error('Verification code is invalid');
    const data = await postAuthData('/auth/two-factor/verify', {
      code, verificationSource: 'WHATSAPP', type: 'FORGET_PASSWORD', target: this.#passwordResetTarget,
    }, this.fetchImpl, this.baseUrl);
    if (typeof data?.passwordResetToken !== 'string' || !data.passwordResetToken) throw new Error('Gateway did not return a password reset token');
    this.#passwordResetToken = data.passwordResetToken;
    return { status: 'verified', target: this.#passwordResetTarget, expiresAt: data.expiresAt };
  }

  async finishPasswordReset(passwords) {
    if (!this.#passwordResetToken) throw new Error('Verify the password reset code in this AI client session first');
    if (!passwords?.newPassword || passwords.newPassword !== passwords.confirmPassword) throw new Error('New passwords do not match');
    const token = this.#passwordResetToken;
    this.#passwordResetToken = null;
    await postAuthData('/auth/password/reset', { passwordResetToken: token, ...passwords }, this.fetchImpl, this.baseUrl);
    this.#passwordResetTarget = null;
    return { status: 'password_reset', signInRequired: true };
  }

  async sendAccountVerificationCode(target) {
    if (typeof target !== 'string' || !/^\+[1-9]\d{6,14}$/.test(target)) throw new Error('Phone number must be E.164');
    await postAuthData('/auth/two-factor/send', { verificationSource: 'WHATSAPP', target, type: 'PHONE_VERIFICATION' }, this.fetchImpl, this.baseUrl, await this.getAccessToken());
    return { status: 'code_requested', target };
  }

  async verifyAccountCode(code) {
    if (typeof code !== 'string' || !/^\d{4,10}$/.test(code)) throw new Error('Verification code is invalid');
    const data = await postAuthData('/auth/two-factor/verify', { code, verificationSource: 'WHATSAPP' }, this.fetchImpl, this.baseUrl, await this.getAccessToken());
    return { status: 'verified', phoneNumber: data?.phoneNumber ?? null };
  }

  async #adoptSession(session) {
    const gateway = new GatewayApiClient({
      accessTokenProvider: { getAccessToken: async () => session.accessToken },
      fetchImpl: this.fetchImpl,
      baseUrl: this.baseUrl,
    });
    const profile = await gateway.getMyProfile();
    this.#accessToken = session.accessToken;
    this.#expiresAt = Date.now() + Math.max(0, Number(session.expiresIn) || 0) * 1000;
    await this.#rememberRefreshToken(session.refreshToken);
    this.#signedOut = false;
    return { ...profile, sessionPersistence: this.#sessionPersistence };
  }

  async getAccessToken() {
    if (this.#signedOut) throw new Error('Gateway login required. Use the connect skill or call connect_gateway_account in this local AI client.');
    if (this.#accessToken && Date.now() < this.#expiresAt - 60_000) return this.#accessToken;
    if (!this.#refreshInFlight) {
      this.#refreshInFlight = this.#refresh().finally(() => { this.#refreshInFlight = null; });
    }
    return this.#refreshInFlight;
  }

  async #refresh() {
    const refreshToken = this.#memoryRefreshToken ?? await this.store.getRefreshToken();
    const session = await postAuth('/auth/refresh', { refreshToken }, this.fetchImpl, this.baseUrl);
    this.#accessToken = session.accessToken;
    this.#expiresAt = Date.now() + Math.max(0, Number(session.expiresIn) || 0) * 1000;
    await this.#rememberRefreshToken(session.refreshToken);
    return this.#accessToken;
  }

  async #rememberRefreshToken(token) {
    this.#memoryRefreshToken = token;
    try {
      await this.store.setRefreshToken(token);
      this.#sessionPersistence = 'keychain';
    } catch {
      this.#sessionPersistence = 'memory_only';
      // A failed overwrite can leave a previous account's token in Keychain.
      // Best effort cleanup prevents that account silently returning later.
      if (typeof this.store.deleteRefreshToken === 'function') {
        try { await this.store.deleteRefreshToken(); } catch { this.#sessionPersistence = 'memory_only_stale_keychain_possible'; }
      }
    }
  }
}
