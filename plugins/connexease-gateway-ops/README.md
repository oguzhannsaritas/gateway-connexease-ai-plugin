# Connexease Gateway Operations

This is a local macOS Claude Code/MCP plugin for account operations and public documentation questions. Version: 0.10.0. It remains separate from the panel repository. See the repository [capability matrix](../../CAPABILITY_MATRIX.md) for feature status and remaining gaps.

Install the combined Claude plugin from this repository's marketplace:

```bash
claude plugin marketplace add oguzhannsaritas/gateway-connexease-ai-plugin
claude plugin install connexease-gateway-ops@connexease-gateway-ai
```

## Developer setup

Requires macOS, Node.js 20+, npm, Claude Code and the system `/usr/bin/expect` utility. From this directory:

```bash
npm ci
npm test
npm run probe
```

`npm run probe` checks MCP discovery only; it sends no Gateway request. To load this checkout without publishing, launch `claude --plugin-dir /absolute/path/to/this/folder`. For the published marketplace version, follow the repository README. The `.mcp.json` launches a local stdio process using `node`.

Inside Claude Code, use `/connexease-gateway-ops:ask` for live public-doc questions without account login. For account operations, use `/connexease-gateway-ops:connect`, then `/connexease-gateway-ops:panel-ops` or `/connexease-gateway-ops:sandbox-ops`. The connect command opens native email and hidden-password dialogs, calls `POST /auth/token`, checks `GET /users/me`, and stores only the refresh token in the current macOS user's Keychain when possible. The plugin never reads the panel browser cookie or asks for credentials in chat. If Keychain saving fails, it keeps the verified account in process memory and attempts to remove any older stored Gateway token. A failed cleanup is explicitly reported. `disconnect_gateway_account` attempts both Keychain deletion and `POST /auth/logout`, reporting each outcome separately.

For a single Insight page table or chart, use `/connexease-gateway-ops:insights`. It calls only the report underlying the named widget and returns a preformatted terminal table. Time-series widgets include a monochrome Unicode/braille line chart for the selected metric; category widgets include a bar chart. The chart keeps readable numeric axes and date endpoints without ANSI colors, and comparison charts share one y-axis scale. This is not the panel's interactive browser chart. The panel's Apps Overview widget still has mock/Coming Soon data, so the plugin reports it as unavailable rather than fabricating account data.

For a comparison, ask the same skill to compare one widget across two explicit start/end date ranges. It returns A and B totals, B-minus-A absolute and percentage differences, and two shared-scale text line charts for time series. Percentages are undefined when A is zero. The tool warns when date ranges overlap or differ in duration; paginated breakup data must be fully loaded before a result is shown.

## Safety model

Reads use the signed-in user's API session. Application-specific tools check that the application is visible to that account. Account/API writes use explicit tool arguments for non-secret fields, an exact native macOS confirmation, and a fresh read before the one write request. The Claude skill asks for chat approval first; the native dialog is the independently enforced approval boundary. Cancelling it makes no write. There is no automatic retry after a write timeout or server error, because the outcome can be unknown. Insights CSV export is a local file write approved through a native save dialog; it will not overwrite an existing file.

Passwords, verification codes, webhook header values, API keys and organization secret values are never returned to Claude. Passwords/codes and webhook values are entered in hidden native dialogs; newly created keys are displayed once in a local native dialog. Metadata reads omit raw keys and webhook headers. Local file upload uses a native picker so Claude never supplies a filesystem path. The selected file's identity is checked again before upload.

Sandbox template sends use the Gateway template's internal UUID and revalidate approved status, components, parameters and the app-owned test number immediately before POST. Product and carousel sends are blocked when the current sandbox request cannot represent them safely. Gateway acceptance is not a WhatsApp delivery receipt. Do not put secret parameter values in a template preview.

## Validation limits

The automated suite uses isolated HTTP stubs and does not contact a live account. Authentication and the legacy application-list fallback were manually tested in earlier versions, but the expanded 0.6.0 operations require dedicated staging verification. Existing routes and request shapes were compared to the panel helpers and locally available core-service source; deployed environments may differ.

The bundled docs skill reads only the live official public documentation and cannot authorize an account mutation. The optional docs-only plugin and Gemini CLI skill in this repository do not expose the operations MCP server. Account operations are not a ChatGPT, Gemini, or Claude web-chat connector; a hosted integration with per-user authorization is separate work.
