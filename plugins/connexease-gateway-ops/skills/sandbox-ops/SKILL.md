---
name: sandbox-ops
description: Inspect the signed-in Connexease Gateway account and run a real WhatsApp sandbox text test after choosing or adding a test number and receiving explicit user confirmation.
---

# Gateway sandbox operations

The bundled MCP server reads the developer's real Gateway account after they sign in. Start with `get_my_profile` when account identity matters. If it reports that login is required, direct the developer to `/connexease-gateway-ops:connect`; that command opens native macOS dialogs. Never ask them to disclose a password, access token, or refresh token in chat.

For a sandbox task, call `list_my_applications`, ask the user which application to use if unclear, then call `list_sandbox_test_numbers` and show the available labels and phone numbers. Ask whether they want to use one of these or add a different number. To add a number, ask for its E.164 phone number and optional label. Only call `add_sandbox_test_number` after the user explicitly asks to add it; the plugin also opens a native macOS confirmation showing the exact number. Adding a number does not send a message. If the number already exists, use that record rather than creating a duplicate.

For a text send, collect the application, registered test number and exact message. Call `prepare_sandbox_text` and show its application, recipient and full message to the user. Explain `status: not_sent` means no message was sent yet and ask “Bu mesajı gerçekten göndereyim mi?” Wait for an explicit affirmative answer about this preview before calling `send_sandbox_text`. The tool rechecks that the number belongs to the selected application and opens a second native macOS confirmation with the exact message. Never treat an earlier approval to add a number as approval to send. If the user cancels either dialog, report no change or no send.

Call `send_sandbox_text` only once for each explicit approval. If the request fails or times out, its outcome may be unknown: do not retry automatically or claim it was not sent. Direct the user to check Gateway sandbox history first. A successful tool response means Gateway accepted the sandbox send, not that WhatsApp delivery was confirmed.

For account inspection, use `get_application`, `list_whatsapp_templates`, `get_whatsapp_template`, `get_webhook_status`, or `list_api_key_metadata` as appropriate. The list tools return one page at a time; if `pagingMetadata.hasNext` is true, request the next `pageNumber` when a full list is needed. Webhook secret headers and raw API keys are deliberately omitted, so never claim to have seen their values.

Only test-number addition and confirmed text sends are writable. Do not bypass native confirmation with shell, browser, or other tools. Template sends, API-key changes, webhook edits and other panel writes are unavailable. If a live read fails, report the failure rather than inventing account data.
