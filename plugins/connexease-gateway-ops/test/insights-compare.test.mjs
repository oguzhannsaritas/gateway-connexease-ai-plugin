import assert from 'node:assert/strict';
import test from 'node:test';
import { compareInsightsPeriods } from '../src/insights-compare.mjs';

const periodA = { startDate: '2026-09-01', endDate: '2026-09-02' };
const periodB = { startDate: '2026-10-01', endDate: '2026-10-02' };

test('compares one time-series widget with two scoped reads, totals, percentages and shared-scale line charts', async () => {
  const calls = [];
  const gateway = { getInsightsReport: async (args) => {
    calls.push(args);
    const earlier = args.startDate === periodA.startDate;
    return { data: { series: earlier ? [
      { timestamp: '2026-09-01', total: 4, incoming: 1, outgoing: 2, template: 1 },
      { timestamp: '2026-09-02', total: 6, incoming: 2, outgoing: 3, template: 1 },
    ] : [
      { timestamp: '2026-10-01', total: 7, incoming: 3, outgoing: 3, template: 1 },
      { timestamp: '2026-10-02', total: 8, incoming: 4, outgoing: 3, template: 1 },
    ] } };
  } };
  const result = await compareInsightsPeriods(gateway, {
    view: 'messagesOverTime', periodA, periodB, appId: 'my-app', metric: 'incoming',
  });
  assert.deepEqual(calls, [
    { report: 'messages', ...periodA, appId: 'my-app', granularity: 'daily' },
    { report: 'messages', ...periodB, appId: 'my-app', granularity: 'daily' },
  ]);
  assert.deepEqual(result.rows, [{ metric: 'incoming', periodA: 3, periodB: 7, delta: 4, percent: 133.33333333333331 }]);
  assert.match(result.terminalDisplay, /A: 2026-09-01 to 2026-09-02/);
  assert.match(result.terminalDisplay, /LINE CHART A: incoming \(shared y-scale\)/);
  assert.match(result.terminalDisplay, /LINE CHART B: incoming \(shared y-scale\)/);
  assert.doesNotMatch(result.terminalDisplay, /marketing|Apps Overview/);
});

test('compares every metric of a named summary without summing snapshot rows', async () => {
  const gateway = { getInsightsReport: async ({ startDate }) => ({ data: {
    applicationsCount: startDate === periodA.startDate ? 2 : 3,
    totalMessageCount: startDate === periodA.startDate ? 10 : 15,
    totalTemplateMessageCount: 0, totalMetaCost: 0, totalCost: 0,
  } }) };
  const result = await compareInsightsPeriods(gateway, { view: 'summary', periodA, periodB });
  assert.equal(result.rows.length, 5);
  assert.deepEqual(result.rows[0], { metric: 'applicationsCount', periodA: 2, periodB: 3, delta: 1, percent: 50 });
  assert.deepEqual(result.rows[1], { metric: 'totalMessageCount', periodA: 10, periodB: 15, delta: 5, percent: 50 });
  assert.equal(result.rows[2].percent, null);
  assert.match(result.terminalDisplay, /n\/a percentage means period A was zero/);
  assert.doesNotMatch(result.terminalDisplay, /LINE CHART/);
});

test('category comparison aligns categories by name and treats a missing category as zero', async () => {
  const gateway = { getInsightsReport: async ({ startDate }) => ({ data: { categories: startDate === periodA.startDate
    ? [{ category: 'marketing', messageCount: 10, metaCost: 2, totalCost: 3 }]
    : [{ category: 'utility', messageCount: 4, metaCost: 1, totalCost: 1.5 }],
  } }) };
  const result = await compareInsightsPeriods(gateway, { view: 'messagesByCategory', periodA, periodB, metric: 'messageCount' });
  assert.deepEqual(result.rows, [
    { category: 'marketing', metric: 'messageCount', periodA: 10, periodB: 0, delta: -10, percent: -100 },
    { category: 'utility', metric: 'messageCount', periodA: 0, periodB: 4, delta: 4, percent: null },
  ]);
  assert.match(result.terminalDisplay, /utility\s+\| messageCount/);
  assert.match(result.terminalDisplay, /n\/a/);
});

test('Messages Breakup comparison reads every page before computing totals', async () => {
  const calls = [];
  const gateway = { getInsightsReport: async (args) => {
    calls.push(args);
    const a = args.startDate === periodA.startDate;
    const page = args.pageNumber;
    return { data: [{ date: `${a ? '2026-09' : '2026-10'}-0${page}`, templateSent: (a ? 2 : 5) * page, outgoingSession: 0, incomingSession: 0 }],
      pagingMetadata: { currentPage: page, totalPages: 2, hasNext: page === 1 } };
  } };
  const result = await compareInsightsPeriods(gateway, { view: 'messagesBreakup', periodA, periodB, metric: 'templateSent' });
  assert.deepEqual(calls.map(({ startDate, pageNumber, pageSize }) => [startDate, pageNumber, pageSize]), [
    [periodA.startDate, 1, 100], [periodA.startDate, 2, 100], [periodB.startDate, 1, 100], [periodB.startDate, 2, 100],
  ]);
  assert.deepEqual(result.rows, [{ metric: 'templateSent', periodA: 6, periodB: 15, delta: 9, percent: 150 }]);
  assert.equal(result.periodA.sourceRows, 2);
  assert.equal(result.periodA.requests, 2);
});

test('Template Breakup compares the complete series, not its 10-row display page', async () => {
  const gateway = { getInsightsReport: async ({ startDate }) => ({ data: { series: Array.from({ length: 12 }, (_, index) => ({
    timestamp: `2026-${startDate === periodA.startDate ? '09' : '10'}-${String(index + 1).padStart(2, '0')}`,
    categories: [{ category: 'marketing', messageCount: startDate === periodA.startDate ? 1 : 2 }],
  })) } }) };
  const result = await compareInsightsPeriods(gateway, { view: 'templateBreakup', periodA, periodB, metric: 'marketing' });
  assert.deepEqual(result.rows, [{ metric: 'marketing', periodA: 12, periodB: 24, delta: 12, percent: 100 }]);
  assert.equal(result.periodA.sourceRows, 12);
});

test('invalid dates and unsupported granularity fail before fetching; overlapping and unequal ranges are labeled', async () => {
  let requests = 0;
  const gateway = { getInsightsReport: async () => {
    requests += 1;
    return { data: { series: [] } };
  } };
  await assert.rejects(compareInsightsPeriods(gateway, { view: 'messagesOverTime', periodA: { startDate: '2026-02-30', endDate: '2026-03-01' }, periodB }), /real calendar date/);
  await assert.rejects(compareInsightsPeriods(gateway, { view: 'messagesOverTime', periodA: { ...periodA, startDate: '2026-09-03' }, periodB }), /must not be after/);
  await assert.rejects(compareInsightsPeriods(gateway, { view: 'summary', periodA, periodB, granularity: 'hourly' }), /does not support granularity/);
  assert.equal(requests, 0);
  const result = await compareInsightsPeriods(gateway, {
    view: 'messagesOverTime', periodA, periodB: { startDate: '2026-09-02', endDate: '2026-09-04' },
  });
  assert.equal(requests, 2);
  assert.match(result.terminalDisplay, /different lengths/);
  assert.match(result.terminalDisplay, /ranges overlap/);
  assert.match(result.terminalDisplay, /no table rows/);
});

test('too many breakup pages fail rather than returning partial comparison', async () => {
  let requests = 0;
  const gateway = { getInsightsReport: async () => {
    requests += 1;
    return { data: [{ date: '2026-09-01', templateSent: 1, outgoingSession: 1, incomingSession: 1 }], pagingMetadata: { hasNext: true } };
  } };
  await assert.rejects(compareInsightsPeriods(gateway, { view: 'messagesBreakup', periodA, periodB }), /Partial totals were not returned/);
  assert.equal(requests, 50);
});

test('inconsistent breakup metadata fails rather than presenting an incomplete total', async () => {
  let requests = 0;
  const gateway = { getInsightsReport: async () => {
    requests += 1;
    return { data: [{ date: '2026-09-01', templateSent: 1, outgoingSession: 0, incomingSession: 0 }],
      pagingMetadata: { currentPage: 1, totalPages: 2, hasNext: false, totalCount: 2 } };
  } };
  await assert.rejects(compareInsightsPeriods(gateway, { view: 'messagesBreakup', periodA, periodB }), /inconsistent breakup pagination/);
  assert.equal(requests, 1);
});

test('Apps Overview comparison is unavailable without querying Gateway', async () => {
  const result = await compareInsightsPeriods({ getInsightsReport: async () => { throw new Error('should not call'); } }, { view: 'appsOverview', periodA, periodB });
  assert.equal(result.status, 'unavailable');
});
