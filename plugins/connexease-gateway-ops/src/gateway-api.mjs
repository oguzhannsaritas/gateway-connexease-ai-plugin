export const DEFAULT_API_BASE_URL = 'https://api-gateway.connexease.com/api/v1';

function assertIdentifier(value, name) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(value)) {
    throw new Error(`${name} must be a valid identifier`);
  }
  return value;
}

function assertUuid(value, name) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`${name} must be a UUID`);
  }
  return value;
}

function requireArray(value, name) {
  if (!Array.isArray(value)) throw new Error(`Gateway returned an invalid ${name} response`);
  return value;
}

function assertPage(value, name, max) {
  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new Error(`${name} must be an integer between 1 and ${max}`);
  }
}

class GatewayHttpError extends Error {
  constructor(status) {
    super(`Gateway request failed (HTTP ${status})`);
    this.status = status;
  }
}

export class GatewayApiClient {
  #applicationRoute = '/applications';

  constructor({ accessTokenProvider, fetchImpl = fetch, baseUrl = DEFAULT_API_BASE_URL }) {
    if (!accessTokenProvider || typeof accessTokenProvider.getAccessToken !== 'function') {
      throw new Error('A per-user access token provider is required');
    }
    const url = new URL(baseUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
      throw new Error('Gateway API base URL must be a clean HTTPS URL');
    }
    this.baseUrl = url.href.replace(/\/+$/, '');
    this.accessTokenProvider = accessTokenProvider;
    this.fetchImpl = fetchImpl;
  }

  async #requestResponse(path, { method = 'GET', body } = {}) {
    const token = await this.accessTokenProvider.getAccessToken();
    if (typeof token !== 'string' || !token) throw new Error('Gateway login required');
    const url = new URL(`${this.baseUrl}${path}`);
    if (url.origin !== new URL(this.baseUrl).origin) throw new Error('Invalid Gateway URL');

    let response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: 'error',
        signal: AbortSignal.timeout(method === 'GET' ? 10000 : 20000),
      });
    } catch {
      throw new Error(method === 'GET'
        ? 'Gateway is unreachable; no account data was loaded'
        : 'Gateway write outcome is unknown. Check the panel before retrying.');
    }
    if (response.status === 401) throw new Error('Gateway session expired; sign in again');
    if (response.status === 403) throw new Error('Gateway account does not have access');
    if (method !== 'GET' && response.status >= 500) {
      throw new Error('Gateway write outcome is unknown. Check the panel before retrying.');
    }
    if (!response.ok) throw new GatewayHttpError(response.status);

    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new Error(method === 'GET'
        ? 'Gateway returned an invalid JSON response'
        : 'Gateway write outcome is unknown. Check the panel before retrying.');
    }
    if (!payload || payload.isSuccess === false) {
      throw new Error(method === 'GET'
        ? 'Gateway request was not successful'
        : 'Gateway write outcome is unknown. Check the panel before retrying.');
    }
    return payload;
  }

  async #request(path) {
    return (await this.#requestResponse(path)).data;
  }

  async #post(path, body) {
    return (await this.#requestResponse(path, { method: 'POST', body })).data;
  }

  async #requestApplication(path = '') {
    try {
      return await this.#request(`${this.#applicationRoute}${path}`);
    } catch (error) {
      // Production still serves the older WhatsApp-scoped read endpoints.
      if (this.#applicationRoute !== '/applications' || !(error instanceof GatewayHttpError) || error.status !== 404) {
        throw error;
      }
      this.#applicationRoute = '/channels/whatsapp/applications';
      return this.#request(`${this.#applicationRoute}${path}`);
    }
  }

  async getMyProfile() {
    const data = await this.#request('/users/me');
    if (!data || typeof data.id !== 'string' || typeof data.email !== 'string') {
      throw new Error('Gateway returned an invalid profile response');
    }
    return { id: data.id, email: data.email, state: data.state };
  }

  async listApplications() {
    const data = requireArray(await this.#requestApplication(), 'applications');
    return data.map((app) => ({
      id: app.id,
      appId: app.appId,
      displayName: app.displayName,
      status: app.status,
    }));
  }

  async #requireApplication(appId) {
    assertIdentifier(appId, 'appId');
    const apps = await this.listApplications();
    if (!apps.some((app) => app.appId === appId)) throw new Error('Application not found in this account');
  }

  async getApplication(appId) {
    await this.#requireApplication(appId);
    const app = await this.#requestApplication(`/${encodeURIComponent(appId)}`);
    if (!app || app.appId !== appId) throw new Error('Gateway returned an invalid application response');
    return {
      id: app.id,
      appId: app.appId,
      displayName: app.displayName,
      status: app.status,
      createdAt: app.createdAt,
      updatedAt: app.updatedAt,
    };
  }

  async listWhatsappTemplates(appId, pageNumber = 1, pageSize = 20) {
    assertPage(pageNumber, 'pageNumber', 1000000);
    assertPage(pageSize, 'pageSize', 100);
    await this.#requireApplication(appId);
    const page = await this.#requestResponse(`/channels/whatsapp/applications/${encodeURIComponent(appId)}/templates?pageNumber=${pageNumber}&pageSize=${pageSize}`);
    const data = requireArray(page.data, 'templates');
    return {
      items: data.map(({ sourceId, name, language, category, status, qualityScore, rejectedReason }) => ({
        sourceId, name, language, category, status, qualityScore, rejectedReason,
      })),
      pagingMetadata: page.pagingMetadata ?? null,
    };
  }

  async getWhatsappTemplate(appId, sourceId) {
    assertIdentifier(sourceId, 'sourceId');
    await this.#requireApplication(appId);
    const template = await this.#request(`/channels/whatsapp/applications/${encodeURIComponent(appId)}/templates/${encodeURIComponent(sourceId)}`);
    if (!template || template.sourceId !== sourceId) throw new Error('Gateway returned an invalid template response');
    const { name, language, category, status, components, qualityScore, rejectedReason } = template;
    return { sourceId, name, language, category, status, components, qualityScore, rejectedReason };
  }

  async getWebhookStatus(appId) {
    await this.#requireApplication(appId);
    const webhook = await this.#request(`/applications/${encodeURIComponent(appId)}/webhook`);
    if (!webhook) return { configured: false };
    const { id, url, subscribedEvents, isActive, createdAt, updatedAt } = webhook;
    return { configured: true, id, url, subscribedEvents, isActive, createdAt, updatedAt };
  }

  async listApiKeyMetadata(appId, pageNumber = 1, pageSize = 20) {
    assertPage(pageNumber, 'pageNumber', 1000000);
    assertPage(pageSize, 'pageSize', 100);
    await this.#requireApplication(appId);
    const page = await this.#requestResponse(`/applications/${encodeURIComponent(appId)}/api-keys?pageNumber=${pageNumber}&pageSize=${pageSize}`);
    const data = requireArray(page.data, 'API keys');
    return {
      items: data.map(({ id, appId: keyAppId, name, dailyLimit, concurrencyLimit, isActive, expiresAt, createdAt }) => ({
        id, appId: keyAppId, name, dailyLimit, concurrencyLimit, isActive, expiresAt, createdAt,
      })),
      pagingMetadata: page.pagingMetadata ?? null,
    };
  }

  async listTestNumbers(appId) {
    await this.#requireApplication(appId);
    const data = requireArray(await this.#request(`/applications/${encodeURIComponent(appId)}/sandbox/test-numbers`), 'test numbers');
    return data.map((number) => ({
      id: number.id,
      appId: number.appId,
      title: number.title,
      phoneNumber: number.phoneNumber,
    }));
  }

  async prepareSandboxTestNumber({ appId, phoneNumber, title }) {
    assertIdentifier(appId, 'appId');
    if (typeof phoneNumber !== 'string') throw new Error('phoneNumber must be in E.164 format');
    const normalizedPhoneNumber = phoneNumber.startsWith('+') ? phoneNumber : `+${phoneNumber}`;
    if (!/^\+[1-9]\d{6,14}$/.test(normalizedPhoneNumber)) {
      throw new Error('phoneNumber must be in E.164 format');
    }
    if (title !== undefined && (typeof title !== 'string' || !title.trim() || title.length > 50 || /[\r\n\0]/.test(title))) {
      throw new Error('title must contain 1-50 characters');
    }
    const numbers = await this.listTestNumbers(appId);
    const existing = numbers.find((number) => number.phoneNumber === normalizedPhoneNumber);
    if (existing) return { status: 'already_exists', number: existing };
    return {
      status: 'ready',
      preview: { applicationId: appId, phoneNumber: normalizedPhoneNumber, ...(title === undefined ? {} : { title }) },
    };
  }

  async createSandboxTestNumber(prepared) {
    if (prepared?.status !== 'ready') throw new Error('A confirmed test-number preview is required');
    const { applicationId: appId, phoneNumber, title } = prepared.preview;
    const current = await this.prepareSandboxTestNumber({ appId, phoneNumber, title });
    if (current.status === 'already_exists') return current;
    const data = await this.#post(`/applications/${encodeURIComponent(appId)}/sandbox/test-numbers`, {
      phoneNumber,
      ...(title === undefined ? {} : { title }),
    });
    if (!data || data.appId !== appId || data.phoneNumber !== phoneNumber || typeof data.id !== 'string') {
      throw new Error('Gateway test-number creation outcome is unknown. Check the panel before retrying.');
    }
    return {
      status: 'created',
      number: { id: data.id, appId: data.appId, title: data.title, phoneNumber: data.phoneNumber },
    };
  }

  async prepareSandboxText({ appId, testNumberId, message }) {
    assertIdentifier(appId, 'appId');
    assertUuid(testNumberId, 'testNumberId');
    if (typeof message !== 'string' || !message.trim() || message.length > 4096) {
      throw new Error('message must contain 1-4096 characters');
    }
    const numbers = await this.listTestNumbers(appId);
    const number = numbers.find((item) => item.id === testNumberId && item.appId === appId);
    if (!number) throw new Error('Test number not found in this application');
    return {
      status: 'not_sent',
      preview: {
        applicationId: appId,
        testNumberId,
        testNumber: number.title,
        phoneNumber: number.phoneNumber,
        message,
      },
      nextStep: 'Ask the user to approve this exact preview, then use send_sandbox_text. A native confirmation is also required.',
    };
  }

  async sendSandboxText(prepared) {
    if (prepared?.status !== 'not_sent') throw new Error('A confirmed sandbox preview is required');
    const approved = prepared.preview;
    const current = await this.prepareSandboxText({
      appId: approved.applicationId,
      testNumberId: approved.testNumberId,
      message: approved.message,
    });
    if (current.preview.phoneNumber !== approved.phoneNumber || current.preview.testNumber !== approved.testNumber) {
      throw new Error('Sandbox recipient changed; review and confirm again');
    }
    const data = await this.#post(
      `/applications/${encodeURIComponent(approved.applicationId)}/sandbox/messages/test`,
      { testNumberId: approved.testNumberId, messageType: 'CUSTOM', message: approved.message },
    );
    if (!data || data.testNumberId !== approved.testNumberId || data.to !== approved.phoneNumber) {
      throw new Error('Gateway sandbox send outcome is unknown. Check sandbox history before retrying.');
    }
    return {
      status: 'accepted_by_gateway',
      applicationId: approved.applicationId,
      testNumberId: data.testNumberId,
      to: data.to,
      messageId: data.messageId ?? null,
      elapsedMs: data.elapsedMs,
      deliveryConfirmed: false,
    };
  }
}
