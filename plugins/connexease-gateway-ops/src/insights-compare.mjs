import { INSIGHT_VIEWS, renderTerminalLineChart, renderTerminalTable, rowsForView } from './insights-view.mjs';

const MAX_BREAKUP_PAGES = 50;
const BREAKUP_PAGE_SIZE = 100;
const MS_PER_DAY = 86_400_000;

function dateValue(value, name) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${name} must be a YYYY-MM-DD date`);
  }
  const time = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) {
    throw new Error(`${name} must be a real calendar date`);
  }
  return time;
}

function validateRange(range, name) {
  if (!range || typeof range !== 'object' || Array.isArray(range)) throw new Error(`${name} must include startDate and endDate`);
  const start = dateValue(range.startDate, `${name}.startDate`);
  const end = dateValue(range.endDate, `${name}.endDate`);
  if (start > end) throw new Error(`${name}.startDate must not be after endDate`);
  return { startDate: range.startDate, endDate: range.endDate, start, end, days: Math.round((end - start) / MS_PER_DAY) + 1 };
}

function numeric(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Gateway returned an invalid ${name}`);
  return value;
}

function metricNames(mapped, view) {
  if (view === 'summary') return mapped.rows.map((row) => row.metric);
  return mapped.columns.filter((column) => !['date', 'category', 'metric'].includes(column));
}

function formatted(value) {
  if (value === null) return 'n/a';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(value);
}

function comparisonRow(name, first, second, category) {
  const a = numeric(first, `${name} period A`);
  const b = numeric(second, `${name} period B`);
  const delta = b - a;
  if (!Number.isFinite(delta)) throw new Error(`Gateway returned an invalid ${name} difference`);
  const percent = a === 0 ? null : delta / Math.abs(a) * 100;
  if (percent !== null && !Number.isFinite(percent)) throw new Error(`Gateway returned an invalid ${name} percentage change`);
  return { ...(category === undefined ? {} : { category }), metric: name, periodA: a, periodB: b, delta, percent };
}

function compareMapped(view, first, second, metric) {
  const available = metricNames(first, view);
  if (metric !== undefined && !available.includes(metric)) {
    throw new Error(`Metric ${metric} is not available for ${view}. Choose one of: ${available.join(', ')}`);
  }
  const selected = metric === undefined ? available : [metric];
  if (view === 'summary') {
    const a = new Map(first.rows.map((row) => [row.metric, row.value]));
    const b = new Map(second.rows.map((row) => [row.metric, row.value]));
    return selected.map((name) => comparisonRow(name, a.get(name), b.get(name)));
  }
  if (view === 'messagesByCategory') {
    const a = new Map(first.rows.map((row) => [row.category, row]));
    const b = new Map(second.rows.map((row) => [row.category, row]));
    const categories = [...new Set([...a.keys(), ...b.keys()])].sort();
    return categories.flatMap((category) => selected.map((name) => comparisonRow(
      name, a.get(category)?.[name] ?? 0, b.get(category)?.[name] ?? 0, category,
    )));
  }
  const sum = (rows, name) => rows.reduce((total, row) => total + numeric(row[name], name), 0);
  return selected.map((name) => comparisonRow(name, sum(first.rows, name), sum(second.rows, name)));
}

async function readPeriod(gateway, view, range, appId, granularity) {
  const spec = INSIGHT_VIEWS[view];
  const common = {
    report: spec.report, startDate: range.startDate, endDate: range.endDate, appId,
    ...(['messagesOverTime', 'messagingCostOverTime', 'messagingCountOverTime', 'messagesBreakup', 'templateBreakup'].includes(view)
      ? { granularity: granularity ?? 'daily' }
      : {}),
  };
  if (view !== 'messagesBreakup') {
    const response = await gateway.getInsightsReport(common);
    return { ...rowsForView(view, response.data), requests: 1 };
  }
  const rows = [];
  let columns;
  for (let pageNumber = 1; pageNumber <= MAX_BREAKUP_PAGES; pageNumber += 1) {
    const response = await gateway.getInsightsReport({ ...common, pageNumber, pageSize: BREAKUP_PAGE_SIZE });
    const mapped = rowsForView(view, response.data);
    columns = mapped.columns;
    rows.push(...mapped.rows);
    const page = response.pagingMetadata;
    const totalPages = page?.totalPages;
    if (page?.currentPage !== undefined && page.currentPage !== pageNumber) throw new Error('Gateway returned inconsistent breakup pagination');
    if (totalPages !== undefined && (!Number.isInteger(totalPages) || totalPages < 0 || totalPages > MAX_BREAKUP_PAGES)) {
      throw new Error(`Breakup comparison needs more than ${MAX_BREAKUP_PAGES} pages or returned invalid pagination; narrow the date ranges. Partial totals were not returned.`);
    }
    if (typeof page?.hasNext === 'boolean' && totalPages !== undefined && page.hasNext !== (pageNumber < totalPages)) {
      throw new Error('Gateway returned inconsistent breakup pagination');
    }
    const hasNext = typeof page?.hasNext === 'boolean'
      ? page.hasNext
      : Number.isInteger(totalPages) ? pageNumber < totalPages : mapped.rows.length === BREAKUP_PAGE_SIZE;
    if (!hasNext) {
      if (page?.totalCount !== undefined && page.totalCount !== rows.length) throw new Error('Gateway returned inconsistent breakup row count; partial totals were not returned');
      return { columns, rows, requests: pageNumber };
    }
    if (mapped.rows.length === 0) throw new Error('Gateway returned an empty breakup page with more pages indicated');
  }
  throw new Error(`Comparison needs more than ${MAX_BREAKUP_PAGES} breakup pages per period; narrow the date ranges. Partial totals were not returned.`);
}

export async function compareInsightsPeriods(gateway, { view, periodA, periodB, appId, granularity, metric } = {}) {
  const spec = INSIGHT_VIEWS[view];
  if (!spec) throw new Error(`Unknown insights view. Choose one of: ${Object.keys(INSIGHT_VIEWS).join(', ')}`);
  if (spec.report === null) return {
    status: 'unavailable', view, title: spec.title,
    terminalDisplay: `${spec.title}\nThis panel widget still displays mock/Coming Soon data. No real Gateway API data was fetched.`,
  };
  const a = validateRange(periodA, 'periodA');
  const b = validateRange(periodB, 'periodB');
  if (granularity !== undefined && !['hourly', 'daily', 'weekly', 'monthly'].includes(granularity)) {
    throw new Error('Unsupported granularity');
  }
  if (granularity !== undefined && !['messagesOverTime', 'messagingCostOverTime', 'messagingCountOverTime', 'messagesBreakup', 'templateBreakup'].includes(view)) {
    throw new Error(`${view} does not support granularity`);
  }
  const first = await readPeriod(gateway, view, a, appId, granularity);
  const second = await readPeriod(gateway, view, b, appId, granularity);
  const rows = compareMapped(view, first, second, metric);
  const tableRows = rows.map((row) => ({
    ...(row.category === undefined ? {} : { category: row.category }), metric: row.metric,
    A: formatted(row.periodA), B: formatted(row.periodB), 'delta B-A': formatted(row.delta), 'delta %': row.percent === null ? 'n/a' : `${formatted(row.percent)}%`,
  }));
  const columns = rows.some((row) => row.category !== undefined)
    ? ['category', 'metric', 'A', 'B', 'delta B-A', 'delta %']
    : ['metric', 'A', 'B', 'delta B-A', 'delta %'];
  const notes = [];
  if (view !== 'summary' && view !== 'messagesByCategory') notes.push('Period totals sum all returned time-series buckets for this widget.');
  if (first.rows.length === 0 || second.rows.length === 0) notes.push('At least one period has no table rows. A missing time-series/category value is treated as zero; verify the selected dates and application.');
  if (a.days !== b.days) notes.push(`Periods have different lengths (${a.days} vs ${b.days} calendar days). These are raw totals, not daily-normalized; equal-length periods give a fairer comparison.`);
  if (a.start <= b.end && b.start <= a.end) notes.push('The date ranges overlap; shared days contribute to both periods.');
  if (rows.some((row) => row.percent === null)) notes.push('n/a percentage means period A was zero; percentage change is undefined.');
  let charts = [];
  if (spec.chartType === 'line' && first.rows.length && second.rows.length) {
    const plotted = metric ?? (view === 'messagesBreakup' ? 'templateSent' : view === 'templateBreakup' ? 'marketing' : 'total');
    const values = [...first.rows, ...second.rows].map((row) => numeric(row[plotted], plotted));
    const scale = { min: Math.min(0, ...values), max: Math.max(0, ...values) };
    charts = [
      `LINE CHART A: ${plotted} (shared y-scale)`, renderTerminalLineChart(first.rows, plotted, 'date', scale),
      `LINE CHART B: ${plotted} (shared y-scale)`, renderTerminalLineChart(second.rows, plotted, 'date', scale),
    ];
    notes.push('Line charts use the same y-axis scale but separate date axes; compare totals in the table.');
  }
  const terminalDisplay = [
    `${spec.title} | period comparison (B - A)`,
    `A: ${a.startDate} to ${a.endDate} (${a.days} days)\nB: ${b.startDate} to ${b.endDate} (${b.days} days)`,
    renderTerminalTable(columns, tableRows),
    ...charts,
    ...notes,
  ].join('\n\n');
  return {
    status: 'ok', view, title: spec.title, report: spec.report,
    periodA: { startDate: a.startDate, endDate: a.endDate, days: a.days, sourceRows: first.rows.length, requests: first.requests },
    periodB: { startDate: b.startDate, endDate: b.endDate, days: b.days, sourceRows: second.rows.length, requests: second.requests },
    rows, notes, terminalDisplay,
  };
}
