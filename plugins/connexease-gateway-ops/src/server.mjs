import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { GatewayApiClient } from './gateway-api.mjs';
import { confirmGatewayAction } from './native-confirm.mjs';
import { NativeSession, promptForGatewayCredentials } from './native-session.mjs';
import { addSandboxTestNumber, sendSandboxTemplate, sendSandboxText } from './sandbox-workflow.mjs';
import { toolResult } from './tool-result.mjs';

const accessTokenProvider = process.platform === 'darwin'
  ? new NativeSession()
  : { getAccessToken: async () => { throw new Error('Local account connection currently supports macOS only'); } };
const gateway = new GatewayApiClient({ accessTokenProvider });
const server = new McpServer({ name: 'connexease-gateway-ops', version: '0.5.0' });
let signInInProgress = false;
let sandboxWriteInProgress = false;

const templateParametersSchema = z.object({
  headerText: z.array(z.string().min(1)).optional(),
  headerMedia: z.object({
    type: z.enum(['IMAGE', 'VIDEO', 'DOCUMENT']),
    link: z.string().min(1).optional(),
    id: z.string().min(1).optional(),
    filename: z.string().min(1).optional(),
  }).strict().optional(),
  body: z.array(z.string().min(1)).optional(),
  buttons: z.array(z.object({
    index: z.number().int().min(0),
    subType: z.enum(['URL', 'COPY_CODE', 'QUICK_REPLY']),
    value: z.string().min(1),
  }).strict()).optional(),
}).strict();

async function oneSandboxWrite(operation) {
  if (sandboxWriteInProgress) throw new Error('Another sandbox write is already in progress');
  sandboxWriteInProgress = true;
  try {
    return await operation();
  } finally {
    sandboxWriteInProgress = false;
  }
}

function guarded(operation) {
  return async (args) => {
    try {
      return toolResult(await operation(args));
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
  description: 'Open native macOS email/password dialogs to sign in to a Gateway account chosen by the user. Do not compare its email with a computer or repository identity. Never ask for credentials in chat or tool arguments. Only call after the user explicitly requests or accepts account connection.',
  annotations: { readOnlyHint: false, destructiveHint: false },
}, guarded(async () => {
  if (process.platform !== 'darwin') throw new Error('In-session sign-in currently supports macOS only');
  if (signInInProgress) throw new Error('Gateway sign-in is already in progress');
  signInInProgress = true;
  try {
    const credentials = await promptForGatewayCredentials();
    const profile = await accessTokenProvider.connectWithCredentials(credentials);
    return {
      status: 'connected',
      id: profile.id,
      email: profile.email,
      sessionPersistence: profile.sessionPersistence,
      ...(profile.sessionPersistence === 'memory_only'
        ? { warning: 'Keychain save failed. This Gateway session works only while this Claude Code session remains open.' }
        : {}),
    };
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
  annotations: { readOnlyHint: true },
}, guarded((args) => gateway.prepareSandboxText(args)));

server.registerTool('add_sandbox_test_number', {
  description: 'Add an E.164 sandbox test number to a selected application after an exact native macOS confirmation. The user must explicitly request adding it. Never use this tool for a different account or application.',
  inputSchema: {
    appId: z.string().min(1).max(100),
    phoneNumber: z.string().min(7).max(16),
    title: z.string().min(1).max(50).optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
}, guarded((args) => oneSandboxWrite(() => addSandboxTestNumber(gateway, confirmGatewayAction, args))));

server.registerTool('send_sandbox_text', {
  description: 'Make one real sandbox WhatsApp text send to a registered test number in the selected application, only after explicit user request and exact native macOS confirmation. Never retry automatically; an error may mean the outcome is unknown.',
  inputSchema: {
    appId: z.string().min(1).max(100),
    testNumberId: z.uuid(),
    message: z.string().min(1).max(4096),
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
}, guarded((args) => oneSandboxWrite(() => sendSandboxText(gateway, confirmGatewayAction, args))));

server.registerTool('prepare_sandbox_template', {
  description: 'Read an APPROVED WhatsApp template, verify the selected test number belongs to the application, validate template parameters and preview the real template send. Does NOT send.',
  inputSchema: {
    appId: z.string().min(1).max(100),
    testNumberId: z.uuid(),
    sourceId: z.string().min(1).max(100),
    parameters: templateParametersSchema.optional(),
  },
  annotations: { readOnlyHint: true },
}, guarded((args) => gateway.prepareSandboxTemplate(args)));

server.registerTool('send_sandbox_template', {
  description: 'Make one real sandbox WhatsApp TEMPLATE send to a registered test number, only after explicit user approval of the preview and exact native macOS confirmation. Unsupported template components are blocked. Never retry automatically.',
  inputSchema: {
    appId: z.string().min(1).max(100),
    testNumberId: z.uuid(),
    sourceId: z.string().min(1).max(100),
    parameters: templateParametersSchema.optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
}, guarded((args) => oneSandboxWrite(() => sendSandboxTemplate(gateway, confirmGatewayAction, args))));

await server.connect(new StdioServerTransport());
