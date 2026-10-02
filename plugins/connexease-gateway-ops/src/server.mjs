import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { GatewayApiClient } from './gateway-api.mjs';
import { NativeSession, promptForGatewayCredentials } from './native-session.mjs';

const accessTokenProvider = process.platform === 'darwin'
  ? new NativeSession()
  : { getAccessToken: async () => { throw new Error('Local account connection currently supports macOS only'); } };
const gateway = new GatewayApiClient({ accessTokenProvider });
const server = new McpServer({ name: 'connexease-gateway-ops', version: '0.3.0' });
let signInInProgress = false;

function result(value) {
  return {
    content: [{ type: 'text', text: JSON.stringify(value) }],
    structuredContent: value,
  };
}

function guarded(operation) {
  return async (args) => {
    try {
      return result(await operation(args));
    } catch (error) {
      return {
        isError: true,
        content: [{ type: 'text', text: error instanceof Error ? error.message : 'Request failed' }],
      };
    }
  };
}

server.registerTool('get_my_profile', {
  description: 'Read the profile of the currently signed-in Connexease Gateway user.',
  annotations: { readOnlyHint: true },
}, guarded(() => gateway.getMyProfile()));

server.registerTool('connect_gateway_account', {
  description: 'Open native macOS email/password dialogs to sign in to the user’s own Gateway account. Never ask for credentials in chat or tool arguments. Only call after the user explicitly requests or accepts account connection.',
  annotations: { readOnlyHint: false, destructiveHint: false },
}, guarded(async () => {
  if (process.platform !== 'darwin') throw new Error('In-session sign-in currently supports macOS only');
  if (signInInProgress) throw new Error('Gateway sign-in is already in progress');
  signInInProgress = true;
  try {
    const credentials = await promptForGatewayCredentials();
    const profile = await accessTokenProvider.connectWithCredentials(credentials);
    return { status: 'connected', id: profile.id, email: profile.email };
  } finally {
    signInInProgress = false;
  }
}));

server.registerTool('list_my_applications', {
  description: 'List applications in the signed-in Connexease Gateway account.',
  annotations: { readOnlyHint: true },
}, guarded(() => gateway.listApplications()));

server.registerTool('get_application', {
  description: 'Read basic metadata for an application in the signed-in Gateway account.',
  inputSchema: { appId: z.string().min(1).max(100) },
  annotations: { readOnlyHint: true },
}, guarded(({ appId }) => gateway.getApplication(appId)));

server.registerTool('list_whatsapp_templates', {
  description: 'Read one paginated page of WhatsApp template metadata for an application.',
  inputSchema: { appId: z.string().min(1).max(100), pageNumber: z.number().int().min(1).optional(), pageSize: z.number().int().min(1).max(100).optional() },
  annotations: { readOnlyHint: true },
}, guarded(({ appId, pageNumber, pageSize }) => gateway.listWhatsappTemplates(appId, pageNumber, pageSize)));

server.registerTool('get_whatsapp_template', {
  description: 'Read one WhatsApp template and its components by source ID.',
  inputSchema: { appId: z.string().min(1).max(100), sourceId: z.string().min(1).max(100) },
  annotations: { readOnlyHint: true },
}, guarded(({ appId, sourceId }) => gateway.getWhatsappTemplate(appId, sourceId)));

server.registerTool('get_webhook_status', {
  description: 'Read webhook status and URL. Secret webhook headers are never returned.',
  inputSchema: { appId: z.string().min(1).max(100) },
  annotations: { readOnlyHint: true },
}, guarded(({ appId }) => gateway.getWebhookStatus(appId)));

server.registerTool('list_api_key_metadata', {
  description: 'List API key names, status, and limits. Raw keys are never returned.',
  inputSchema: { appId: z.string().min(1).max(100), pageNumber: z.number().int().min(1).optional(), pageSize: z.number().int().min(1).max(100).optional() },
  annotations: { readOnlyHint: true },
}, guarded(({ appId, pageNumber, pageSize }) => gateway.listApiKeyMetadata(appId, pageNumber, pageSize)));

server.registerTool('list_sandbox_test_numbers', {
  description: 'List sandbox test numbers for an application in the signed-in Gateway account.',
  inputSchema: { appId: z.string().min(1).max(100) },
  annotations: { readOnlyHint: true },
}, guarded(({ appId }) => gateway.listTestNumbers(appId)));

server.registerTool('prepare_sandbox_text', {
  description: 'Use live account data to validate and preview a sandbox text. Does NOT send any message.',
  inputSchema: {
    appId: z.string().min(1).max(100),
    testNumberId: z.uuid(),
    message: z.string().min(1).max(4096),
  },
  annotations: { readOnlyHint: false, destructiveHint: false },
}, guarded((args) => gateway.prepareSandboxText(args)));

await server.connect(new StdioServerTransport());
