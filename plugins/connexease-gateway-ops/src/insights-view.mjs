/** One named panel widget maps to exactly one Gateway insights report. */
export const INSIGHT_VIEWS = Object.freeze({
  summary: { title: 'Summary / Özet', report: 'summary', chartType: 'none' },
  messagesOverTime: { title: 'Messages / Mesajlar', report: 'messages', chartType: 'line' },
  messagesByCategory: { title: 'Messages by Category / Kategoriye Göre Mesajlar', report: 'categories', chartType: 'bar' },
  messagingCostOverTime: { title: 'Messaging Cost Over Time / Zaman İçinde Mesajlaşma Maliyeti', report: 'messagingCost', chartType: 'line' },
  messagingCountOverTime: { title: 'Messaging Count Over Time / Zaman İçinde Mesaj Sayısı', report: 'messagingCost', chartType: 'line' },
  messagesBreakup: { title: 'Messages Breakup / Mesaj Dağılımı', report: 'messagesBreakup', chartType: 'line' },
  templateBreakup: { title: 'Template Breakup / Şablon Dağılımı', report: 'messagingCost', chartType: 'line' },
  appsOverview: { title: 'Apps Overview / Uygulama Genel Bakışı', report: null, chartType: 'none' },
});

const CATEGORY_NAMES = ['marketing', 'utility', 'authentication', 'service', 'other'];
const SUMMARY_FIELDS = ['applicationsCount', 'totalMessageCount', 'totalTemplateMessageCount', 'totalMetaCost', 'totalCost'];

export function listInsightsViews() {
  return {
    views: Object.entries(INSIGHT_VIEWS).map(([id, view]) => ({
      id, title: view.title, chartType: view.chartType, available: view.report !== null,
    })),
    note: 'Choose one view. A request for one table or chart must not fetch the other views.',
  };
}

function record(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Gateway returned an invalid ${name}`);
  return value;
}

function number(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Gateway returned an invalid ${name}`);
  return value;
}

function label(value) {
  if (typeof value !== 'string') throw new Error('Gateway returned an invalid insights label');
  return value.replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 40);
}

function categoryValue(point, category, field) {
  if (!Array.isArray(point.categories)) throw new Error('Gateway returned invalid insights categories');
  const match = point.categories.find((item) => item?.category === category);
  return match ? number(match[field], `${category}.${field}`) : 0;
}

function rowsForView(view, data) {
  if (view === 'summary') {
    const stats = record(data, 'insights summary');
    return { columns: ['metric', 'value'], rows: SUMMARY_FIELDS.map((metric) => ({ metric, value: number(stats[metric], metric) })), defaultMetric: null };
  }
  if (view === 'messagesBreakup') {
    if (!Array.isArray(data)) throw new Error('Gateway returned invalid message breakup rows');
    return {
      columns: ['date', 'templateSent', 'outgoingSession', 'incomingSession'],
      rows: data.map((point) => ({
        date: label(point.date),
        templateSent: number(point.templateSent, 'templateSent'),
        outgoingSession: number(point.outgoingSession, 'outgoingSession'),
        incomingSession: number(point.incomingSession, 'incomingSession'),
      })),
      defaultMetric: 'templateSent',
    };
  }
  if (view === 'messagesByCategory') {
    const source = record(data, 'category insights');
    if (!Array.isArray(source.categories)) throw new Error('Gateway returned invalid category rows');
    return {
      columns: ['category', 'messageCount', 'metaCost', 'totalCost'],
      rows: source.categories.map((point) => ({
        category: label(point.category), messageCount: number(point.messageCount, 'messageCount'),
        metaCost: number(point.metaCost, 'metaCost'), totalCost: number(point.totalCost, 'totalCost'),
      })),
      defaultMetric: 'messageCount',
    };
  }
  const source = record(data, 'time-series insights');
  if (!Array.isArray(source.series)) throw new Error('Gateway returned invalid insights series');
  if (view === 'messagesOverTime') {
    return {
      columns: ['date', 'total', 'incoming', 'outgoing', 'template'],
      rows: source.series.map((point) => ({
        date: label(point.timestamp), total: number(point.total, 'total'),
        incoming: number(point.incoming, 'incoming'), outgoing: number(point.outgoing, 'outgoing'),
        template: number(point.template, 'template'),
      })),
      defaultMetric: 'total',
    };
  }
  if (view === 'templateBreakup') {
    return {
      columns: ['date', 'marketing', 'utility', 'authentication', 'freeMessages'],
      rows: source.series.map((point) => ({
        date: label(point.timestamp), marketing: categoryValue(point, 'marketing', 'messageCount'),
        utility: categoryValue(point, 'utility', 'messageCount'),
        authentication: categoryValue(point, 'authentication', 'messageCount'),
        freeMessages: categoryValue(point, 'service', 'messageCount'),
      })),
      defaultMetric: 'marketing',
    };
  }
  if (view === 'messagingCostOverTime' || view === 'messagingCountOverTime') {
    const field = view === 'messagingCostOverTime' ? 'totalCost' : 'messageCount';
    return {
      columns: ['date', 'total', ...CATEGORY_NAMES],
      rows: source.series.map((point) => ({
        date: label(point.timestamp),
        total: number(view === 'messagingCostOverTime' ? point.totalCost : point.totalMessageCount, 'total'),
        ...Object.fromEntries(CATEGORY_NAMES.map((category) => [category, categoryValue(point, category, field)])),
      })),
      defaultMetric: 'total',
    };
  }
  throw new Error('Unsupported insights view');
}

function formatValue(value) {
  const output = String(value).replace(/[\x00-\x1f\x7f]/g, ' ');
  return output.length > 20 ? `${output.slice(0, 17)}...` : output;
}

export function renderTerminalTable(columns, rows) {
  const widths = columns.map((column) => Math.max(column.length, ...rows.map((row) => formatValue(row[column]).length)));
  const line = (values) => `| ${values.map((value, index) => formatValue(value).padEnd(widths[index])).join(' | ')} |`;
  return [line(columns), `|-${widths.map((width) => '-'.repeat(width)).join('-|-')}-|`, ...rows.map((row) => line(columns.map((column) => row[column])))].join('\n');
}

function formatAxis(value) {
  if (Math.abs(value) >= 1000) return value.toFixed(0);
  return Number(value.toFixed(3)).toString();
}

/** Plain-text connected line plot; no terminal color or external dependency. */
export function renderTerminalLineChart(rows, metric, xKey = 'date') {
  if (!rows.length) return 'No data for line chart.';
  const values = rows.map((row) => number(row[metric], metric));
  const width = Math.min(60, Math.max(12, (rows.length - 1) * 3 + 1));
  const height = 9;
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const span = max - min || 1;
  const points = values.map((value, index) => ({
    x: rows.length === 1 ? Math.floor(width / 2) : Math.round(index * (width - 1) / (rows.length - 1)),
    y: height - 1 - Math.round((value - min) * (height - 1) / span),
  }));
  const grid = Array.from({ length: height }, () => Array(width).fill(' '));
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    const steps = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y));
    for (let step = 1; step < steps; step += 1) {
      const x = Math.round(from.x + (to.x - from.x) * step / steps);
      const y = Math.round(from.y + (to.y - from.y) * step / steps);
      grid[y][x] = from.y === to.y ? '-' : to.y < from.y ? '/' : '\\';
    }
  }
  for (const point of points) grid[point.y][point.x] = '*';
  const lines = grid.map((cells, index) => {
    const axis = index === 0 ? max : index === height - 1 ? min : index === Math.floor(height / 2) ? (max + min) / 2 : null;
    return `${axis === null ? '        ' : formatAxis(axis).padStart(8)} |${cells.join('')}`;
  });
  lines.push(`         +${'-'.repeat(width)}`);
  const first = formatValue(rows[0][xKey]);
  const last = formatValue(rows.at(-1)[xKey]);
  lines.push(`          ${first}${' '.repeat(Math.max(1, width - first.length - last.length))}${last}`);
  return lines.join('\n');
}

export function renderTerminalBarChart(rows, metric, labelKey) {
  if (!rows.length) return 'No data for bar chart.';
  const displayed = rows.slice(0, 20);
  const max = Math.max(0, ...displayed.map((row) => number(row[metric], metric)));
  const lines = displayed.map((row) => {
    const value = number(row[metric], metric);
    const count = max === 0 ? 0 : Math.round(Math.max(0, value) / max * 24);
    return `${formatValue(row[labelKey]).padEnd(20)} | ${'#'.repeat(count).padEnd(24)} ${formatAxis(value)}`;
  });
  if (rows.length > displayed.length) lines.push(`... ${rows.length - displayed.length} more rows not charted`);
  return lines.join('\n');
}

export async function getInsightsView(gateway, { view, startDate, endDate, appId, granularity, pageNumber = 1, pageSize = 10, metric } = {}) {
  const spec = INSIGHT_VIEWS[view];
  if (!spec) throw new Error(`Unknown insights view. Choose one of: ${Object.keys(INSIGHT_VIEWS).join(', ')}`);
  if (spec.report === null) {
    return {
      status: 'unavailable', view, title: spec.title,
      terminalDisplay: `${spec.title}\nThis panel widget still displays mock/Coming Soon data. No real Gateway API data was fetched.`,
    };
  }
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new Error('pageNumber and pageSize must be positive integers; pageSize cannot exceed 100');
  }
  if (!['messagesBreakup', 'templateBreakup'].includes(view) && (pageNumber !== 1 || pageSize !== 10)) {
    throw new Error('Pagination is available only for breakup tables');
  }
  const report = await gateway.getInsightsReport({
    report: spec.report, startDate, endDate, appId,
    ...(['messagesOverTime', 'messagingCostOverTime', 'messagingCountOverTime', 'messagesBreakup', 'templateBreakup'].includes(view)
      ? { granularity: granularity ?? 'daily' }
      : granularity === undefined ? {} : { granularity }),
    ...(view === 'messagesBreakup' ? { pageNumber, pageSize } : {}),
  });
  const mapped = rowsForView(view, report.data);
  const validMetrics = mapped.columns.filter((column) => column !== 'date' && column !== 'category' && column !== 'metric');
  const selectedMetric = metric ?? mapped.defaultMetric;
  if (selectedMetric !== null && !validMetrics.includes(selectedMetric)) {
    throw new Error(`Metric ${selectedMetric} is not available for ${view}. Choose one of: ${validMetrics.join(', ')}`);
  }
  let rows = mapped.rows;
  let pagingMetadata = view === 'messagesBreakup' ? report.pagingMetadata ?? null : null;
  if (view === 'templateBreakup') {
    const totalRows = rows.length;
    rows = rows.slice((pageNumber - 1) * pageSize, pageNumber * pageSize);
    pagingMetadata = { currentPage: pageNumber, totalPages: Math.max(1, Math.ceil(totalRows / pageSize)), totalRows };
  }
  const chart = spec.chartType === 'line'
    ? renderTerminalLineChart(rows, selectedMetric)
    : spec.chartType === 'bar'
      ? renderTerminalBarChart(rows, selectedMetric, 'category')
      : null;
  const range = startDate || endDate ? `${startDate ?? 'default'} to ${endDate ?? 'default'}` : 'Gateway default range';
  const pageLabel = pagingMetadata ? ` | page ${pagingMetadata.currentPage ?? pageNumber}${pagingMetadata.totalPages ? `/${pagingMetadata.totalPages}` : ''}` : '';
  const terminalDisplay = [
    `${spec.title} | ${range}${pageLabel}`,
    renderTerminalTable(mapped.columns, rows),
    ...(chart ? [`${spec.chartType.toUpperCase()} CHART: ${selectedMetric}`, chart] : []),
  ].join('\n\n');
  return { status: 'ok', view, title: spec.title, report: spec.report, metric: selectedMetric,
    chartType: spec.chartType, rows, pagingMetadata, terminalDisplay };
}
