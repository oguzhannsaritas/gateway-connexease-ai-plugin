# Connexease Gateway Operations

This local Claude Code/MCP plugin is separate from the documentation plugin and the panel repository. It is published in the `plugins/connexease-gateway-ops` directory of the [gateway-connexease-ai-plugin repository](https://github.com/oguzhannsaritas/gateway-connexease-ai-plugin).

After a developer signs in through `/connexease-gateway-ops:connect` inside Claude Code, the MCP server reads their real Gateway account. The plugin opens native macOS credential dialogs; it never takes a password through an AI conversation and never reuses a panel browser cookie or copied token.

| Tool | Current behavior |
| --- | --- |
| `get_my_profile` | Reads the signed-in Gateway user's ID, email, and state |
| `connect_gateway_account` | Opens native macOS credential dialogs and connects the account; returns only profile identity |
| `list_my_applications` | Reads applications visible to the signed-in account; falls back to the production WhatsApp-scoped route where the generic route is absent |
| `get_application` | Reads basic details for a selected application |
| `list_whatsapp_templates`, `get_whatsapp_template` | Reads paginated WhatsApp template metadata and a selected template |
| `get_webhook_status` | Reads webhook status and URL, never secret headers |
| `list_api_key_metadata` | Reads paginated key names and limits, never raw API keys |
| `list_sandbox_test_numbers` | Reads test numbers for one of those applications |
| `prepare_sandbox_text` | Validates a test number and previews a message with `status: not_sent` |

**No MCP tool sends a message.** Preparing a message never calls a write endpoint. The package has no mock account/data layer; automated tests use isolated HTTP stubs and never access production.

Account reads are read-only. `connect_gateway_account` attempts to save a local Keychain session and falls back to process memory if Keychain fails, while `prepare_sandbox_text` only builds a local preview. The two paginated list tools return `items` and `pagingMetadata`; request additional pages with `pageNumber` as needed. This is not a complete panel automation plugin yet: creating/revoking keys, editing webhooks or templates, and sending messages remain disabled. Those operations need a trusted per-action confirmation and, for sandbox sends, backend binding/idempotency work outside this plugin-only scope.

## Local macOS setup

Requires Node.js 20+, macOS Keychain, and the system `/usr/bin/expect` utility. The Gateway login request goes to `https://api-gateway.connexease.com/api/v1/auth/token` with `X-Client-Type: native`; the password is entered in a masked macOS dialog. The plugin attempts to store the refresh token in the current macOS user's Keychain, never in the repository, an environment variable, or an AI prompt. The Keychain helper answers `security`'s terminal prompt through a private pseudo-terminal; it does not put the token in process arguments or logs. If that save fails, the access and refresh tokens remain only in MCP process memory until the Claude Code session ends, and the tool returns `sessionPersistence: memory_only`. Access tokens are renewed through `/auth/refresh`.

```bash
npm ci
npm test
npm run probe
```

`npm run probe` only checks MCP tool discovery; it does **not** call Gateway. The preferred login is `/connexease-gateway-ops:connect` from inside Claude Code. Its native dialogs collect credentials outside the chat, verify `/users/me`, and list applications. Apple's masked field only hides the text on screen; the local plugin process briefly handles the password in memory. If dialogs cannot open, `npm run login` remains a fallback in a trusted interactive terminal; it hides terminal echo and checks `/users/me`.

For development, load this directory as a plugin in a fresh Claude Code session:

```bash
claude --plugin-dir /absolute/path/to/this/folder
```

Use `/connexease-gateway-ops:connect` once to sign in, then ask Claude to list your Gateway applications or use `/connexease-gateway-ops:sandbox-ops`. `/mcp` should show the `gateway-account` server connected. The existing `connexease-gateway-docs` plugin remains independent.

This local stdio plugin does not automatically work in Claude/ChatGPT/Gemini **web chat**. A hosted HTTPS MCP server with per-user browser OAuth authorization is still required for those surfaces; this native login is not that integration.

## Before enabling sends

The panel uses `POST /applications/:appId/sandbox/messages/test` with `{ testNumberId, messageType: "CUSTOM", message }`. The core-service `origin/develop` send handler checks the application's organization and active status, but its test-number lookup currently filters by organization and number ID rather than app ID. Confirm the intended cross-application behavior and add the correct binding before exposing any AI-driven send.

A send feature also needs an explicit trusted confirmation tied to the exact app, recipient, and message; durable one-use approval and audit records; and a strategy for ambiguous outcomes that avoids duplicate sends. Do not add a direct `send` MCP tool before these pieces exist.

The authentication and read endpoints are based on the locally available core-service ref and panel source. A manual production sign-in verified authentication and `/users/me`, but Keychain persistence failed on the test Mac and the generic application-list route returned HTTP 404. Version 0.3.3 falls back to the production WhatsApp-scoped list/detail route on that 404; a signed-in live application read with this fallback still needs manual verification.
