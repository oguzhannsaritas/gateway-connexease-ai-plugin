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

export function rowsForView(view, data) {
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

function compactAxis(value) {
  const magnitude = Math.abs(value);
  for (const [threshold, suffix] of [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'k']]) {
    if (magnitude >= threshold) return `${Number((value / threshold).toFixed(2))}${suffix}`;
  }
  return Number(value.toFixed(2)).toString();
}

const BRAILLE_BITS = [[0x01, 0x02, 0x04, 0x40], [0x08, 0x10, 0x20, 0x80]];

/** Smooth monochrome line plot using Unicode braille; safe inside monospace tool output. */
export function renderTerminalLineChart(rows, metric, xKey = 'date', scale) {
  if (!rows.length) return 'No data for line chart.';
  const values = rows.map((row) => number(row[metric], metric));
  const width = Math.min(60, Math.max(28, (rows.length - 1) * 4 + 1));
  const height = 9;
  const min = scale?.min ?? Math.min(0, ...values);
  const max = scale?.max ?? Math.max(0, ...values);
  if (!Number.isFinite(min) || !Number.isFinite(max) || min > max || values.some((value) => value < min || value > max)) {
    throw new Error('Invalid line chart scale');
  }
  const plotMax = max === min ? max + 1 : max + (max - min) * 0.06;
  const span = plotMax - min;
  const pixelWidth = width * 2;
  const pixelHeight = height * 4;
  const points = values.map((value, index) => ({
    x: rows.length === 1 ? Math.floor(pixelWidth / 2) : Math.round(index * (pixelWidth - 1) / (rows.length - 1)),
    y: Math.round((plotMax - value) * (pixelHeight - 1) / span),
  }));
  const cells = Array.from({ length: height }, () => new Uint8Array(width));
  const dot = (x, y) => {
    cells[Math.floor(y / 4)][Math.floor(x / 2)] |= BRAILLE_BITS[x % 2][y % 4];
  };
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    const steps = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y));
    if (steps === 0) {
      dot(from.x, from.y);
      continue;
    }
    for (let step = 0; step <= steps; step += 1) {
      const x = Math.round(from.x + (to.x - from.x) * step / steps);
      const y = Math.round(from.y + (to.y - from.y) * step / steps);
      dot(x, y);
    }
  }
  for (const point of points) dot(point.x, point.y);
  const axisLabels = [plotMax, (plotMax + min) / 2, min].map(compactAxis);
  const axisWidth = Math.max(5, ...axisLabels.map((value) => value.length));
  const lines = cells.map((row, index) => {
    const label = index === 0 ? axisLabels[0] : index === Math.floor(height / 2) ? axisLabels[1] : index === height - 1 ? axisLabels[2] : '';
    const glyphs = Array.from(row, (bits) => bits ? String.fromCodePoint(0x2800 + bits) : ' ');
    if (index === Math.floor(points[0].y / 4)) glyphs[Math.floor(points[0].x / 2)] = '●';
    const last = points.at(-1);
    if (index === Math.floor(last.y / 4)) glyphs[Math.floor(last.x / 2)] = '●';
    return `${label.padStart(axisWidth)} ${label ? '┤' : '│'} ${glyphs.join('')}`.trimEnd();
  });
  lines.push(`${' '.repeat(axisWidth)} └${'─'.repeat(width + 1)}`);
  const labelLimit = Math.floor((width - 2) / 2);
  const first = formatValue(rows[0][xKey]).slice(0, labelLimit);
  const last = formatValue(rows.at(-1)[xKey]).slice(0, labelLimit);
  lines.push(`${' '.repeat(axisWidth + 3)}${rows.length === 1 ? first : first.padEnd(width - last.length) + last}`);
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
