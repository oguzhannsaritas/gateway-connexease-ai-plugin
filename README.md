# Connexease Gateway AI plugin

A Claude Code plugin for reading a developer's own Connexease Gateway account. This is an early, **read-only** release. It is separate from the [Gateway documentation plugin](https://github.com/oguzhannsaritas/gateway-ai-plugin).

The plugin can read your profile, applications, WhatsApp templates, webhook status, API key metadata, and sandbox test numbers. It can prepare a sandbox text preview, but **does not send messages** or change panel settings. Raw API keys and secret webhook headers are never returned to Claude.

## Install in Claude Code

Requires macOS, Node.js 20+, npm, and Claude Code. Authentication currently uses the signed-in macOS user's Keychain. It has not yet been live-tested with a real Gateway account.

First, install the marketplace plugin:

```bash
claude plugin marketplace add oguzhannsaritas/gateway-connexease-ai-plugin
claude plugin install connexease-gateway-ops@connexease-gateway-ai
claude plugin list
```

Then clone the public source and sign in from a trusted terminal. The password is hidden while typed and is never entered into Claude chat:

```bash
git clone https://github.com/oguzhannsaritas/gateway-connexease-ai-plugin.git
cd gateway-connexease-ai-plugin/plugins/connexease-gateway-ops
npm ci
npm run login
```

The refresh token is stored in your macOS Keychain. The plugin uses it to obtain an access token for your Gateway account. Do not share passwords or tokens in prompts, screenshots, logs, or issues.

Start a fresh Claude Code session (or run `/reload-plugins` in an existing one), then ask:

```text
Gateway hesabımdaki uygulamaları listele.
```

You can also invoke `/connexease-gateway-ops:sandbox-ops`. If Claude asks permission for the `gateway-account` MCP server, review the request before accepting. `npm run probe` in the plugin directory only verifies tool discovery; it does not contact Gateway.

## Scope and limitations

- This release is local Claude Code integration on macOS. It is not a ChatGPT, Gemini, or Claude web-chat connector.
- No tool sends a message, creates or revokes an API key, or edits a webhook or template. `prepare_sandbox_text` returns `status: not_sent`.
- The login and live account reads have automated tests with HTTP stubs, but have **not** been verified against a real user account yet. Please report sanitized errors without credentials or account data.
- The published source is open to inspect. No credentials, account data, or `node_modules` are committed.

For implementation details and developer checks, see [the plugin README](plugins/connexease-gateway-ops/README.md).
