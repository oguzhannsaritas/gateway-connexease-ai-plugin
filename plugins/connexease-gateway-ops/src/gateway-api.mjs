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

  async #requestResponse(path) {
    const token = await this.accessTokenProvider.getAccessToken();
    if (typeof token !== 'string' || !token) throw new Error('Gateway login required');
    const url = new URL(`${this.baseUrl}${path}`);
    if (url.origin !== new URL(this.baseUrl).origin) throw new Error('Invalid Gateway URL');

    let response;
    try {
      response = await this.fetchImpl(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      throw new Error('Gateway is unreachable; no account data was loaded');
    }
    if (response.status === 401) throw new Error('Gateway session expired; sign in again');
    if (response.status === 403) throw new Error('Gateway account does not have access');
    if (!response.ok) throw new GatewayHttpError(response.status);

    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new Error('Gateway returned an invalid JSON response');
    }
    if (!payload || payload.isSuccess === false) throw new Error('Gateway request was not successful');
    return payload;
  }

  async #request(path) {
    return (await this.#requestResponse(path)).data;
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
      nextStep: 'Sending remains disabled until a trusted, explicit confirmation flow is implemented.',
    };
  }
}
