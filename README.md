# Connexease Gateway AI plugin

This repository combines the Connexease Gateway account-operations plugin and the public-documentation assistant. The Claude Code `connexease-gateway-ops` installation includes both: use `/connexease-gateway-ops:ask` for documentation and the existing account tools for your own Gateway account. Documentation questions do not require signing in to Gateway. Operations version: 0.10.0.

## Install in Claude Code

Requires macOS, Node.js 20+, npm, and Claude Code. Authentication uses native macOS dialogs and the signed-in user's Keychain.

```bash
claude plugin marketplace add oguzhannsaritas/gateway-connexease-ai-plugin
claude plugin install connexease-gateway-ops@connexease-gateway-ai
claude
```

For a documentation question, ask normally or use `/connexease-gateway-ops:ask`. It reads the live public Gateway documentation and cites only pages it verifies. To use account operations, run `/connexease-gateway-ops:connect`. The password is entered in a hidden local dialog, not a chat prompt. If Keychain persistence fails, the plugin reports that the session is memory-only; if it cannot remove an older stored token, it warns that the older account may return after restart.

Examples:

```text
Gateway sandbox'ta gerçek mesaj göndermeden API isteğini nasıl test ederim? Doküman linkini de ver.
Gateway hesabımdaki uygulamaları ve WhatsApp sağlık durumlarını göster.
Bu uygulamanın webhook durumunu ve onaylı template'lerini listele.
Test numaralarını göster; seçtiğim numaraya mesajı göndermeden önce önizlet.
```

The first example is a read-only public-documentation question. Account-specific reads and writes use the separate scoped tools and existing approval rules. A documentation page is never permission to send a message or change an account.

`/connexease-gateway-ops:panel-ops` explains available account, application, template, webhook, billing, insight, and security operations. `/connexease-gateway-ops:sandbox-ops` walks through a real sandbox send. Writes require explicit approval in chat and a second native macOS confirmation. Secrets are entered or displayed locally, never passed to Claude in tool arguments or responses. A successful sandbox API response means Gateway accepted the request, not that WhatsApp delivered it.

The `/connexease-gateway-ops:insights` skill maps a named Insight page widget to one API report. It prints only that widget's table, plus a smooth monochrome Unicode line chart for time-series data or a bar chart for category data. The line chart uses braille dots, readable axes and date labels without terminal color codes. `Apps Overview` remains unavailable because the panel still displays mock/Coming Soon data there.

The comparison workflow accepts two explicit date ranges for one Insight widget. It displays period values, B-minus-A differences and percentage changes, with shared-scale line charts for time series. Paginated breakup comparisons load every page or fail rather than reporting partial totals.

## Documentation-only and other AI clients

For the legacy `/connexease-gateway-docs:ask` command, this marketplace also contains an optional read-only `connexease-gateway-docs` plugin. New Claude users need only `connexease-gateway-ops`; installing both creates two documentation commands. The old [documentation repository](https://github.com/oguzhannsaritas/gateway-ai-plugin) and any existing installation remain untouched. Existing users may keep the old plugin or migrate manually; no uninstall happens automatically.

The same repository carries a portable **documentation-only** plugin for Codex CLI/ChatGPT desktop and a Gemini CLI skill. Neither receives the Claude account-operation MCP tools:

```bash
codex plugin marketplace add oguzhannsaritas/gateway-connexease-ai-plugin
codex plugin add connexease-gateway-docs@connexease-gateway-ai
```

```bash
gemini skills install https://github.com/oguzhannsaritas/gateway-connexease-ai-plugin.git --path gemini-cli/connexease-gateway-docs
```

These new-repository install paths still need an independent installation test. ChatGPT web and Gemini web/app do not automatically load these local plugins; see [distribution status](DISTRIBUTION.md) and the [manual Gemini chat draft](guides/gemini-chat-instructions.md).

For updates:

```bash
claude plugin marketplace update connexease-gateway-ai
claude plugin update connexease-gateway-ops@connexease-gateway-ai
```

Restart Claude Code after updating. See [capability matrix](CAPABILITY_MATRIX.md) for supported operations and the separately reported gaps, and [implementation details](plugins/connexease-gateway-ops/README.md) for local validation and security boundaries.

The account-operation tools remain a local macOS Claude Code plugin, not a ChatGPT/Gemini/Claude web-chat connector. Those surfaces need a separately designed hosted integration and per-user authorization for account actions.
