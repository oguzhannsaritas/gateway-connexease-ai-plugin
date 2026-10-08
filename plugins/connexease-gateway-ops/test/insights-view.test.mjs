import assert from 'node:assert/strict';
import test from 'node:test';
import { getInsightsView, listInsightsViews, renderTerminalBarChart, renderTerminalLineChart, renderTerminalTable } from '../src/insights-view.mjs';

test('lists panel widget names without querying Gateway and marks Apps Overview as mock-only', () => {
  const views = listInsightsViews().views;
  assert.equal(views.find((item) => item.id === 'messagesBreakup').title.includes('Mesaj Dağılımı'), true);
  assert.deepEqual(views.find((item) => item.id === 'appsOverview'), {
    id: 'appsOverview', title: 'Apps Overview / Uygulama Genel Bakışı', chartType: 'none', available: false,
  });
});

test('named Messages Breakup makes one report call and prints only that table with a line chart', async () => {
  const calls = [];
  const gateway = { getInsightsReport: async (args) => {
    calls.push(args);
    return { report: 'messagesBreakup', data: [
      { date: '2026-10-01', templateSent: 2, outgoingSession: 3, incomingSession: 4 },
      { date: '2026-10-02', templateSent: 7, outgoingSession: 5, incomingSession: 6 },
    ], pagingMetadata: { currentPage: 2, totalPages: 3 } };
  } };
  const result = await getInsightsView(gateway, {
    view: 'messagesBreakup', startDate: '2026-10-01', endDate: '2026-10-07',
    appId: 'my-app', pageNumber: 2, pageSize: 2, metric: 'outgoingSession',
  });
  assert.deepEqual(calls, [{ report: 'messagesBreakup', startDate: '2026-10-01', endDate: '2026-10-07', appId: 'my-app', granularity: 'daily', pageNumber: 2, pageSize: 2 }]);
  assert.equal(result.report, 'messagesBreakup');
  assert.equal(result.chartType, 'line');
  assert.match(result.terminalDisplay, /Messages Breakup \/ Mesaj Dağılımı/);
  assert.match(result.terminalDisplay, /LINE CHART: outgoingSession/);
  assert.match(result.terminalDisplay, /2026-10-01/);
  assert.doesNotMatch(result.terminalDisplay, /Marketing|totalCost|Apps Overview/);
  assert.equal(result.rows.length, 2);
});

test('Template Breakup derives only its selected page from a single messaging-cost response', async () => {
  const calls = [];
  const gateway = { getInsightsReport: async (args) => {
    calls.push(args);
    return { report: 'messagingCost', data: { stats: { totalCost: 999 }, series: [
      { timestamp: '2026-10-01', categories: [{ category: 'marketing', messageCount: 2 }, { category: 'service', messageCount: 1 }] },
      { timestamp: '2026-10-02', categories: [{ category: 'marketing', messageCount: 5 }, { category: 'utility', messageCount: 4 }] },
    ] } };
  } };
  const result = await getInsightsView(gateway, { view: 'templateBreakup', pageNumber: 2, pageSize: 1, metric: 'utility' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].report, 'messagingCost');
  assert.equal(calls[0].granularity, 'daily');
  assert.deepEqual(result.rows, [{ date: '2026-10-02', marketing: 5, utility: 4, authentication: 0, freeMessages: 0 }]);
  assert.deepEqual(result.pagingMetadata, { currentPage: 2, totalPages: 2, totalRows: 2 });
  assert.match(result.terminalDisplay, /LINE CHART: utility/);
  assert.doesNotMatch(result.terminalDisplay, /999|2026-10-01/);
});

test('time-series chart uses only requested message metric; category chart is a bar chart', async () => {
  const reports = [];
  const gateway = { getInsightsReport: async (args) => {
    reports.push(args.report);
    if (args.report === 'messages') return { data: { stats: {}, series: [
      { timestamp: '2026-10-01', total: 5, incoming: 1, outgoing: 3, template: 1 },
      { timestamp: '2026-10-02', total: 10, incoming: 2, outgoing: 6, template: 2 },
    ] } };
    if (args.report === 'categories') return { data: { categories: [
      { category: 'marketing', messageCount: 5, metaCost: 1, totalCost: 2 },
      { category: 'utility', messageCount: 3, metaCost: 0.5, totalCost: 1 },
    ] } };
    throw new Error('unexpected report');
  } };
  const line = await getInsightsView(gateway, { view: 'messagesOverTime', metric: 'incoming' });
  assert.match(line.terminalDisplay, /LINE CHART: incoming/);
  assert.deepEqual(reports, ['messages']);
  const bar = await getInsightsView(gateway, { view: 'messagesByCategory', metric: 'totalCost' });
  assert.match(bar.terminalDisplay, /BAR CHART: totalCost/);
  assert.match(bar.terminalDisplay, /marketing\s+\|/);
  assert.deepEqual(reports, ['messages', 'categories']);
});

test('Apps Overview never substitutes mock data or queries unrelated reports', async () => {
  const result = await getInsightsView({ getInsightsReport: async () => { throw new Error('must not call Gateway'); } }, { view: 'appsOverview' });
  assert.equal(result.status, 'unavailable');
  assert.match(result.terminalDisplay, /mock\/Coming Soon/);
});

test('terminal renderers handle empty, one-point and untrusted label data safely', () => {
  assert.equal(renderTerminalLineChart([], 'total'), 'No data for line chart.');
  assert.match(renderTerminalLineChart([{ date: '2026-10-01', total: 0 }], 'total'), /●/);
  assert.equal(renderTerminalBarChart([], 'count', 'category'), 'No data for bar chart.');
  assert.doesNotMatch(renderTerminalTable(['date', 'value'], [{ date: '2026-10-01\nattack', value: 1 }]), /\nattack/);
  assert.throws(() => renderTerminalLineChart([{ date: '2026-10-01', total: 'secret' }], 'total'), /invalid total/);
});

test('line chart has a smooth monochrome curve, readable axes and bounded width', () => {
  const rows = [2, 4, 3, 8, 6, 12, 10, 15].map((total, index) => ({
    date: `2026-10-${String(index + 1).padStart(2, '0')}`, total,
  }));
  const chart = renderTerminalLineChart(rows, 'total');
  assert.match(chart, /[\u2801-\u28ff]/);
  assert.match(chart, /●/);
  assert.match(chart, /└─/);
  assert.match(chart, /2026-10-01\s+2026-10-08/);
  assert.doesNotMatch(chart, /\x1b\[/);
  assert.ok(chart.split('\n').every((line) => line.length <= 80));
});

test('line chart handles crowded and shared-scale series without dividing by zero', () => {
  const rows = Array.from({ length: 200 }, (_, index) => ({ date: String(index), total: index % 9 }));
  const chart = renderTerminalLineChart(rows, 'total', 'date', { min: 0, max: 10 });
  assert.match(chart, /[\u2801-\u28ff]/);
  assert.match(chart, /199/);
  assert.throws(() => renderTerminalLineChart(rows, 'total', 'date', { min: 0, max: 1 }), /Invalid line chart scale/);
});
