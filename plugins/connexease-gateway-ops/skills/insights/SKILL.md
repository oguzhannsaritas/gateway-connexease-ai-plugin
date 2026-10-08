---
name: insights
description: Show exactly one requested Connexease Gateway Insight page table or chart in the Claude Code terminal, with a matching text line/bar chart when available.
---

# One Insight widget at a time

Use the bundled `gateway-account` MCP tools. If sign-in is required, ask the developer to run `/connexease-gateway-ops:connect`. When the user names **one** Insight page table or chart, call `get_insights_view` exactly once for that widget. Do not fetch all Insight reports, call `get_insights_export_rows`, or show neighboring cards merely because they share an API response. If the name is unclear, use `list_insights_views` and ask the user which one they mean.

Map the panel labels to `view`:

- `Mesaj Dağılımı` / `Messages Breakup` → `messagesBreakup`
- `Şablon Dağılımı` / `Template Breakup` → `templateBreakup`
- `Mesajlar` / `Messages` (time-series line chart) → `messagesOverTime`
- `Kategoriye Göre Mesajlar` / `Messages by Category` → `messagesByCategory`
- `Zaman İçinde Mesajlaşma Maliyeti` / `Messaging Cost Over Time` → `messagingCostOverTime`
- `Zaman İçinde Mesaj Sayısı` / `Messaging Count Over Time` → `messagingCountOverTime`
- `Özet` / `Summary` → `summary`
- `Uygulama Genel Bakışı` / `Apps Overview` → `appsOverview`; this panel widget is still mock/Coming Soon, so the tool does **not** fetch or invent real data.

Pass the requested date range, application, granularity and metric only when specified. If no date range is given, say the Gateway default applies. For breakup tables, `pageNumber`/`pageSize` select only that table's page; any line chart is based on exactly those returned rows. For other time-series widgets, the default granularity is daily, as in the panel. The `metric` parameter selects a single plotted series; the table still shows all columns of the **same** widget. If metric is omitted, the tool picks the primary series.

Show the tool's `terminalDisplay` verbatim in a monospace code block. It already contains the selected table and a plain-text line chart for time-series data or a bar chart for category data. Do not render another table/chart from the structured rows unless the user asks. Do not call `get_insights_report` to supplement the selected widget. Never imply that an ASCII plot is the panel's interactive browser chart or that unavailable mock data is live.
