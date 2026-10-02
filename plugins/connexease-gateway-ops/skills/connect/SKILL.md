---
name: connect
description: Sign in to a Connexease Gateway account from inside Claude Code, then show the user's applications. Use when the user asks to connect/login to Gateway, wants to see their own apps but is not signed in, or invokes /connexease-gateway-ops:connect.
---

# Connect to Connexease Gateway

Tell the user that the plugin will open two native macOS dialogs for their email and hidden password. Never ask them to type credentials in the conversation or pass credentials to a tool.

Call `connect_gateway_account` without arguments. The MCP server handles the dialogs, verifies the account, and attempts to save a refresh token in macOS Keychain. If the user cancels or the dialog is unavailable, report that outcome without asking for secrets in chat. Do not use shell or browser automation as a workaround.

After `status: connected`, call `list_my_applications` and show the returned applications. If `sessionPersistence` is `memory_only`, clearly tell the user that Keychain saving failed and the login lasts only until this Claude Code session ends. If the application read fails, state that the account connected but the application list could not be loaded; do not invent data.
