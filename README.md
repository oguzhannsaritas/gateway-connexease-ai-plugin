# Connexease Gateway AI plugin

A Claude Code plugin for reading a developer's own Connexease Gateway account. This is an early, **read-only** release. It is separate from the [Gateway documentation plugin](https://github.com/oguzhannsaritas/gateway-ai-plugin).

The plugin can read your profile, applications, WhatsApp templates, webhook status, API key metadata, and sandbox test numbers. It can prepare a sandbox text preview, but **does not send messages** or change panel settings. Raw API keys and secret webhook headers are never returned to Claude.

## Install in Claude Code

Requires macOS, Node.js 20+, npm, and Claude Code. Authentication currently uses native macOS dialogs and the signed-in user's Keychain. It has not yet been live-tested with a real Gateway account.

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

The plugin opens native macOS dialogs for your email and hidden password, verifies your account, then lists your applications. The password is passed to the Gateway authentication endpoint by the local MCP process; it is never sent through the Claude conversation or returned by an MCP tool. The refresh token is stored in your macOS Keychain. Do not share passwords or tokens in prompts, screenshots, logs, or issues. Apple's hidden-answer dialog only masks the screen; like any password login, the local process briefly handles the password in memory.

On later sessions, simply ask:

```text
Gateway hesabımdaki uygulamaları listele.
```

You can also invoke `/connexease-gateway-ops:sandbox-ops`. If Claude asks permission for the `gateway-account` MCP server or the connection tool, review the request before accepting. If native dialogs cannot open, the separate terminal `npm run login` command remains a fallback; see [the plugin README](plugins/connexease-gateway-ops/README.md). `npm run probe` only verifies tool discovery; it does not contact Gateway.

## Scope and limitations

- This release is local Claude Code integration on macOS. It is not a ChatGPT, Gemini, or Claude web-chat connector.
- No tool sends a message, creates or revokes an API key, or edits a webhook or template. `prepare_sandbox_text` returns `status: not_sent`.
- The login and live account reads have automated tests with HTTP stubs, but have **not** been verified against a real user account yet. The native dialog has only been syntax-checked, not interactively tested. Please report sanitized errors without credentials or account data.
- The published source is open to inspect. No credentials, account data, or `node_modules` are committed.

For implementation details and developer checks, see [the plugin README](plugins/connexease-gateway-ops/README.md).
