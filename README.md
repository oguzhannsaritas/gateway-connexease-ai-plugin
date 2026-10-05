# Connexease Gateway AI plugin

A Claude Code plugin for a developer's Connexease Gateway account. It is separate from the [Gateway documentation plugin](https://github.com/oguzhannsaritas/gateway-ai-plugin).

The plugin can read your profile, applications, WhatsApp templates, webhook status, API key metadata, and sandbox test numbers. It can also add a sandbox test number and make one real sandbox WhatsApp text send after explicit chat approval and a native macOS confirmation. Raw API keys and secret webhook headers are never returned to Claude.

## Install in Claude Code

Requires macOS, Node.js 20+, npm, and Claude Code. Authentication currently uses native macOS dialogs and attempts to use the signed-in user's Keychain.

Install the marketplace plugin and start Claude Code:

```bash
claude plugin marketplace add oguzhannsaritas/gateway-connexease-ai-plugin
claude plugin install connexease-gateway-ops@connexease-gateway-ai
claude
```

Inside Claude Code, run:

```text
/connexease-gateway-ops:connect
```

The plugin opens native macOS dialogs for your email and hidden password, verifies your account, then lists your applications. The password is passed to the Gateway authentication endpoint by the local MCP process; it is never sent through the Claude conversation or returned by an MCP tool. The plugin attempts to store a refresh token in your macOS Keychain. If Keychain saving fails, it reports `memory_only`: the account can still be used in the current Claude Code session, but you must sign in again after restarting. Do not share passwords or tokens in prompts, screenshots, logs, or issues. Apple's hidden-answer dialog only masks the screen; like any password login, the local process briefly handles the password in memory.

On later sessions, simply ask:

```text
Gateway hesabımdaki uygulamaları listele.
```

You can also invoke `/connexease-gateway-ops:sandbox-ops`. If Claude asks permission for the `gateway-account` MCP server or the connection tool, review the request before accepting. If native dialogs cannot open, the separate terminal `npm run login` command remains a fallback; see [the plugin README](plugins/connexease-gateway-ops/README.md). `npm run probe` only verifies tool discovery; it does not contact Gateway.

For a real sandbox text test, ask Claude to show your application's test numbers. You can select one or provide another E.164 number to add. Adding it and sending a message are separate actions. Before a send, Claude must show the selected application, recipient and exact message, ask for approval, then open a macOS confirmation dialog. A successful API response means the Gateway accepted the send; it does not prove WhatsApp delivery.

## Scope and limitations

- This release is local Claude Code integration on macOS. It is not a ChatGPT, Gemini, or Claude web-chat connector.
- `add_sandbox_test_number` and `send_sandbox_text` are the only account writes. No tool creates or revokes an API key or edits a webhook or template. `prepare_sandbox_text` remains read-only and returns `status: not_sent`.
- The sandbox write flow has automated tests with HTTP stubs, but has **not** been used to send a real message in this release. The production backend does not provide an idempotency key for this endpoint. If a send fails or times out, check sandbox history before retrying; do not assume it failed.
- The published source is open to inspect. No credentials, account data, or `node_modules` are committed.

For implementation details and developer checks, see [the plugin README](plugins/connexease-gateway-ops/README.md).
