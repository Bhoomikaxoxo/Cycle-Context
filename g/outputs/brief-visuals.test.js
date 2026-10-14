import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateCycleSparklineSVG,
  buildExecutiveSummaryData,
  formatClinicalDate
} from './brief-visuals.js';

test('generateCycleSparklineSVG: renders graceful placeholder when no intervals provided', () => {
  const svg = generateCycleSparklineSVG([]);
  assert.ok(svg.includes('<svg'));
  assert.ok(svg.includes('No completed cycle intervals'));
});

test('generateCycleSparklineSVG: renders valid SVG with FIGO corridor, median line, and bars', () => {
  const intervals = [
    { start: { date: '2026-05-01' }, end: { date: '2026-05-30' }, days: 29 },
    { start: { date: '2026-05-30' }, end: { date: '2026-07-04' }, days: 35 },
    { start: { date: '2026-07-04' }, end: { date: '2026-08-15' }, days: 42 }, // prolonged
    { start: { date: '2026-08-15' }, end: { date: '2026-09-06' }, days: 22 }  // shortened
  ];

  const svg = generateCycleSparklineSVG(intervals, { width: 600, height: 120 });
  assert.ok(svg.includes('<svg'));
  assert.ok(svg.includes('FIGO Normal Range (24–38 days)'));
  assert.ok(svg.includes('Median 29.0d'));
  assert.ok(svg.includes('42d'));
  assert.ok(svg.includes('22d'));
  assert.ok(svg.includes('29d'));
  assert.ok(svg.includes('class="cycle-bar prolonged"'));
  assert.ok(svg.includes('class="cycle-bar shortened"'));
  assert.ok(svg.includes('class="cycle-bar normal"'));
});

test('buildExecutiveSummaryData: evaluates normal cycles correctly', () => {
  const analysis = {
    summary: { min: 27, max: 31, median: 29, spread: 4 },
    basedOnCycles: 4
  };
  const intervals = [
    { days: 28 }, { days: 30 }, { days: 29 }, { days: 31 }
  ];
  const durations = [
    { days: 5 }, { days: 4 }
  ];
  const medications = [
    { name: 'Myo-Inositol', dosage: '2000 mg', status: 'active', includeInSummary: true }
  ];
  const questions = [
    { text: 'How do my current cycles compare to normal ranges?', disabled: false }
  ];

  const summary = buildExecutiveSummaryData({ analysis, intervals, durations, medications, questions });

  assert.equal(summary.freqCategory, 'Normal Cycle Frequency');
  assert.equal(summary.freqBadge, 'normal');
  assert.equal(summary.regularityCategory, 'Regular Cycle Variation');
  assert.equal(summary.regularityBadge, 'normal');
  assert.equal(summary.bleedCategory, 'Normal Bleeding Duration');
  assert.equal(summary.bleedBadge, 'normal');
  assert.equal(summary.activeMedsCount, 1);
  assert.ok(summary.activeMedsSummary.includes('Myo-Inositol (2000 mg)'));
  assert.equal(summary.priorityQuestions.length, 1);
});

test('buildExecutiveSummaryData: flags infrequent cycles and elevated variation', () => {
  const analysis = {
    summary: { min: 28, max: 48, median: 36, spread: 20 },
    basedOnCycles: 5
  };
  const intervals = [{ days: 28 }, { days: 48 }, { days: 36 }];
  const durations = [{ days: 10 }]; // prolonged bleeding >8d

  const summary = buildExecutiveSummaryData({ analysis, intervals, durations });

  assert.equal(summary.freqCategory, 'Infrequent / Extended Cycles');
  assert.equal(summary.freqBadge, 'attention');
  assert.equal(summary.regularityCategory, 'Elevated Cycle Variation');
  assert.equal(summary.regularityBadge, 'attention');
  assert.equal(summary.bleedCategory, 'Prolonged Bleeding Episode');
  assert.equal(summary.bleedBadge, 'attention');
});

test('formatClinicalDate: formats ISO date to clinical DD-MMM-YYYY standard', () => {
  assert.equal(formatClinicalDate('2026-10-14'), '14-Oct-2026');
  assert.equal(formatClinicalDate('2026-01-05'), '05-Jan-2026');
  assert.equal(formatClinicalDate(''), '');
});
