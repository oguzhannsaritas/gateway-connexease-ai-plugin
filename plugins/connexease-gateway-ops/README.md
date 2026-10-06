# Connexease Gateway Operations

This local Claude Code/MCP plugin is separate from the documentation plugin and the panel repository. It is published in the `plugins/connexease-gateway-ops` directory of the [gateway-connexease-ai-plugin repository](https://github.com/oguzhannsaritas/gateway-connexease-ai-plugin).

After a developer signs in through `/connexease-gateway-ops:connect` inside Claude Code, the MCP server reads their real Gateway account. The plugin opens native macOS credential dialogs; it never takes a password through an AI conversation and never reuses a panel browser cookie or copied token.

| Tool | Current behavior |
| --- | --- |
| `get_my_profile` | Reads the signed-in Gateway user's ID, email, and state |
| `connect_gateway_account` | Opens native macOS credential dialogs and connects the account; returns only profile identity |
| `list_my_applications` | Reads applications visible to the signed-in account; falls back to the production WhatsApp-scoped route where the generic route is absent; returns `{ items: [...] }` |
| `get_application` | Reads basic details for a selected application |
| `list_whatsapp_templates`, `get_whatsapp_template` | Reads paginated WhatsApp template metadata and a selected template |
| `get_webhook_status` | Reads webhook status and URL, never secret headers |
| `list_api_key_metadata` | Reads paginated key names and limits, never raw API keys |
| `list_sandbox_test_numbers` | Reads test numbers for one of those applications; returns `{ items: [...] }` |
| `prepare_sandbox_text` | Validates a test number and previews a message with `status: not_sent` |
| `prepare_sandbox_template` | Validates an approved template, its variables, and an app-owned test number; previews without sending |
| `add_sandbox_test_number` | Adds an E.164 test number after native macOS confirmation; detects an existing number |
| `send_sandbox_text` | Makes one real sandbox WhatsApp text send after native macOS confirmation; does not retry |
| `send_sandbox_template` | Makes one real sandbox WhatsApp template send after native macOS confirmation; does not retry |

Both `prepare_*` tools never send. Both `send_*` tools are real external actions: the skill requires an exact preview and explicit chat approval, and the tool independently requires a native macOS confirmation with the recipient and content. The package has no mock account/data layer; automated tests use isolated HTTP stubs and never access production.

Account reads are read-only. `connect_gateway_account` attempts to save a local Keychain session and falls back to process memory if Keychain fails. The two paginated list tools return `items` and `pagingMetadata`; request additional pages with `pageNumber` as needed. This is not a complete panel automation plugin yet: creating/revoking keys and editing webhooks or templates remain disabled.

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

## Real sandbox safeguards and remaining limitations

The plugin uses the panel's `POST /applications/:appId/sandbox/test-numbers` and `POST /applications/:appId/sandbox/messages/test` contracts. It lists numbers first, asks whether to use one or add another, and rechecks the selected number's `appId`, phone and label immediately before the single send request. Adding a number is separately confirmed and does not imply approval to send. Native confirmation details travel through a private stdin pipe, not process arguments. The message preview is deliberately shown in chat for user approval. Test-number additions may be limited by the backend (currently five active numbers per application).

The locally inspected core-service `origin/develop` send handler checks application ownership, but its test-number lookup filters by organization and number ID rather than app ID. The plugin's application-scoped list and recheck prevent cross-application sends through this plugin, but the backend should also enforce that binding. The backend records sandbox actions, but it has no idempotency key for this endpoint; the plugin makes one POST with no automatic retry. A timeout, network error, server error or malformed success response can leave the outcome unknown. Check Gateway sandbox history before any manual retry. `accepted_by_gateway` is not a delivery receipt.

Template sends use `messageType: TEMPLATE` and the Gateway template's internal UUID (not its Meta `sourceId`). The plugin reads and revalidates the approved template immediately before sending, including its exact components and dynamic parameters. Static `REQUEST_CONTACT_INFO` buttons need no parameter. Carousel, product and unsupported components are blocked. Template parameters are visible to Claude as part of the preview, so do not use secret values. Template sending has automated contract tests only; an actual template delivery and the contact-info button have not been verified live.

The authentication and read endpoints are based on the locally available core-service ref and panel source. A manual production sign-in verified authentication and `/users/me`, but Keychain persistence failed on the test Mac and the generic application-list route returned HTTP 404. Version 0.3.3 added fallback to the production WhatsApp-scoped list/detail route; version 0.3.4 fixed the MCP list-result shape. The write tools are verified with isolated contract tests only. No real test number was added or message sent during development.
