# Connexease Gateway AI plugin

A local Claude Code plugin for a developer's own Connexease Gateway account. It is separate from the [Gateway documentation plugin](https://github.com/oguzhannsaritas/gateway-ai-plugin). Current plugin version: 0.7.0.

## Install in Claude Code

Requires macOS, Node.js 20+, npm, and Claude Code. Authentication uses native macOS dialogs and the signed-in user's Keychain.

```bash
claude plugin marketplace add oguzhannsaritas/gateway-connexease-ai-plugin
claude plugin install connexease-gateway-ops@connexease-gateway-ai
claude
```

Inside Claude Code, run `/connexease-gateway-ops:connect`. The password is entered in a hidden local dialog, not a chat prompt. If Keychain persistence fails, the plugin reports that the session is memory-only; if it cannot remove an older stored token, it warns that the older account may return after restart.

After connecting, ask naturally, for example:

```text
Gateway hesabımdaki uygulamaları ve WhatsApp sağlık durumlarını göster.
Bu uygulamanın webhook durumunu ve onaylı template'lerini listele.
Test numaralarını göster; seçtiğim numaraya mesajı göndermeden önce önizlet.
```

`/connexease-gateway-ops:panel-ops` explains available account, application, template, webhook, billing, insight, and security operations. `/connexease-gateway-ops:sandbox-ops` walks through a real sandbox send. Writes require explicit approval in chat and a second native macOS confirmation. Secrets are entered or displayed locally, never passed to Claude in tool arguments or responses. A successful sandbox API response means Gateway accepted the request, not that WhatsApp delivered it.

The `/connexease-gateway-ops:insights` skill maps a named Insight page widget to one API report. It prints only that widget's table, plus an ASCII line chart for time-series data or a bar chart for category data. `Apps Overview` remains unavailable because the panel still displays mock/Coming Soon data there.

For updates after publication:

```bash
claude plugin marketplace update connexease-gateway-ai
claude plugin update connexease-gateway-ops@connexease-gateway-ai
```

Restart Claude Code after updating. See [capability matrix](CAPABILITY_MATRIX.md) for supported operations and the separately reported gaps, and [implementation details](plugins/connexease-gateway-ops/README.md) for local validation and security boundaries.

This is a local Claude Code plugin, not a ChatGPT/Gemini/Claude web-chat connector. Those surfaces require a hosted HTTPS MCP server and per-user browser OAuth.
