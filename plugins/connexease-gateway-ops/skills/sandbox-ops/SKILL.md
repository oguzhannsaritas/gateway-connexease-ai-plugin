---
name: sandbox-ops
description: Read the signed-in Connexease Gateway account's applications, WhatsApp templates, webhook status, API key metadata and sandbox test numbers; prepare a text-message preview without sending it.
---

# Gateway sandbox operations

The bundled MCP server reads the developer's real Gateway account after they sign in locally. Start with `get_my_profile` when account identity matters. If it reports that login is required, tell the developer to run `npm run login` in the plugin folder in their own terminal. Never ask them to disclose a password, access token, or refresh token in chat.

For an application task, call `list_my_applications`, then `list_sandbox_test_numbers` for the chosen application. If the user asks to compose a text, collect the application, test number, and message and call `prepare_sandbox_text`. Show the returned preview and explicitly say `status: not_sent` means no message was sent.

For account inspection, use `get_application`, `list_whatsapp_templates`, `get_whatsapp_template`, `get_webhook_status`, or `list_api_key_metadata` as appropriate. The list tools return one page at a time; if `pagingMetadata.hasNext` is true, request the next `pageNumber` when a full list is needed. Webhook secret headers and raw API keys are deliberately omitted, so never claim to have seen their values.

There are no write or send tools. Do not claim a WhatsApp message was delivered, that a panel setting was changed, or try to bypass the missing confirmation flow with shell, browser, or other tools. If a live read fails, report the failure rather than inventing account data.
