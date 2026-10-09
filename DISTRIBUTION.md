# Distribution and verification status

This repository contains both the Claude operations plugin and public-documentation skills in version 0.10.0. The old `gateway-ai-plugin` repository is not changed or removed.

| Surface | This repository provides | Verification boundary |
| --- | --- | --- |
| Claude Code | One `connexease-gateway-ops` installation with `/connexease-gateway-ops:ask` plus the existing account tools; optional legacy-name docs-only plugin | Local manifest validation and tests verify packaging. New-repository install, live docs answer and account flow still need manual testing |
| Codex CLI / ChatGPT desktop | Portable `connexease-gateway-docs` skills-only plugin from this repo's `.agents/plugins/marketplace.json` | Docs only, not account operations. The old repo was tested earlier; the new repo path is not yet installed or answered live |
| ChatGPT web | No automatic import from the local Git marketplace | Public/workspace distribution is a separate submission or publication process |
| Gemini CLI | `gemini-cli/connexease-gateway-docs` read-only skill | New repo path untested; an earlier machine's OAuth returned `UNSUPPORTED_CLIENT` |
| Gemini web/app | Manual documentation-skill draft | No verified universal install link and no account-operation tools |

The documentation assistants need access to `docs.gateway.connexease.com` and a live web/URL-reading tool for current answers. Packaging does not guarantee the model opens or cites the correct page. The Claude account tools are scoped separately and require the user's own account and the native confirmation flow for writes. A GitHub push alone does not submit this plugin to any public AI plugin directory.
