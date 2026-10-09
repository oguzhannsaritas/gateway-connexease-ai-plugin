# Connexease Gateway AI plugin

This repository combines Connexease Gateway account operations and the public-documentation assistant. The `connexease-gateway-ops` package includes both: documentation questions need no Gateway login, while account operations use the user's own Gateway account. Operations version: 0.11.0.

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

## Codex and Gemini CLI

For the legacy `/connexease-gateway-docs:ask` command, this marketplace also contains an optional read-only `connexease-gateway-docs` plugin. New Claude users need only `connexease-gateway-ops`; installing both creates two documentation commands. The old [documentation repository](https://github.com/oguzhannsaritas/gateway-ai-plugin) and any existing installation remain untouched. Existing users may keep the old plugin or migrate manually; no uninstall happens automatically.

Codex CLI/desktop can install the same operations plugin from this repository's portable marketplace. The optional `connexease-gateway-docs` package remains read-only:

```bash
codex plugin marketplace add oguzhannsaritas/gateway-connexease-ai-plugin
codex plugin add connexease-gateway-ops@connexease-gateway-ai
codex
```

In Codex, ask naturally (for example, “Gateway hesabıma bağlan ve uygulamalarımı göster”) or invoke an installed skill by name through the Codex skill picker. The operations package supplies `ask`, `connect`, `panel-ops`, `sandbox-ops`, and `insights` skills and the `gateway-account` MCP tools; it is not limited to documentation questions. Codex does not use Claude's `/connexease-gateway-ops:...` command syntax.

For Gemini CLI, install the repository as an extension, not the older docs-only skill:

```bash
gemini extensions install https://github.com/oguzhannsaritas/gateway-connexease-ai-plugin.git
gemini
```

Gemini CLI can answer natural-language requests or use `/connexease-gateway:ask`, `/connexease-gateway:connect`, `/connexease-gateway:panel-ops`, `/connexease-gateway:sandbox-ops`, and `/connexease-gateway:insights`. The extension bundles the same local account server and skills. The operations flow requires macOS, Node.js 20+, visible native dialogs, the user's Gateway credentials entered locally, explicit chat approval for writes, and a separate native confirmation.

These new install paths are prepared in source but still need independent end-to-end installation and account testing after publication. ChatGPT web and Gemini web/app do not automatically load local Git plugins; see [distribution status](DISTRIBUTION.md) and the [manual Gemini chat draft](guides/gemini-chat-instructions.md).

For updates:

```bash
claude plugin marketplace update connexease-gateway-ai
claude plugin update connexease-gateway-ops@connexease-gateway-ai
```

Restart Claude Code after updating. See [capability matrix](CAPABILITY_MATRIX.md) for supported operations and the separately reported gaps, and [implementation details](plugins/connexease-gateway-ops/README.md) for local validation and security boundaries.

The account-operation tools remain a local macOS integration for Claude Code, Codex, and Gemini CLI, not a ChatGPT/Gemini/Claude web-chat connector. Those surfaces need a separately designed hosted integration and per-user authorization for account actions.
