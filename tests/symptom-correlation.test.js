import { test } from "node:test";
import assert from "node:assert/strict";
import {
  determineEntryPhase,
  analyzeSymptomCorrelations,
  filterCorrelations,
  buildSymptomCycleMatrix,
  PHASE_CONFIG,
} from "../src/modules/symptom-correlation.js";

test("determineEntryPhase: unlinked when no period starts", () => {
  const res = determineEntryPhase("2026-05-10", []);
  assert.equal(res.phaseSlug, "unlinked");
  assert.equal(res.cycleDay, null);
});

test("determineEntryPhase: identifies menstrual phase during bleeding", () => {
  const starts = ["2026-05-01", "2026-05-29"];
  const bleeds = [{ start: "2026-05-01", end: "2026-05-05", days: 5 }];

  // Day 1
  const d1 = determineEntryPhase("2026-05-01", starts, bleeds);
  assert.equal(d1.phaseSlug, "menstrual");
  assert.equal(d1.cycleDay, 1);

  // Day 5
  const d5 = determineEntryPhase("2026-05-05", starts, bleeds);
  assert.equal(d5.phaseSlug, "menstrual");
  assert.equal(d5.cycleDay, 5);
});

test("determineEntryPhase: identifies pre-menstrual (late luteal) window", () => {
  const starts = ["2026-05-01", "2026-05-29"];
  const bleeds = [{ start: "2026-05-01", end: "2026-05-05", days: 5 }];

  // May 26 is 3 days before May 29
  const res = determineEntryPhase("2026-05-26", starts, bleeds);
  assert.equal(res.phaseSlug, "pre-menstrual");
  assert.equal(res.daysBeforeNext, 3);
  assert.ok(res.phaseName.includes("3d before bleeding"));
});

test("determineEntryPhase: identifies mid-cycle / ovulatory window", () => {
  const starts = ["2026-05-01", "2026-05-29"]; // 28 day cycle -> mid around day 14 (days 12-16)
  const bleeds = [{ start: "2026-05-01", end: "2026-05-05", days: 5 }];

  // Day 14 is May 14
  const res = determineEntryPhase("2026-05-14", starts, bleeds);
  assert.equal(res.phaseSlug, "mid-cycle");
  assert.equal(res.cycleDay, 14);
});

test("determineEntryPhase: identifies follicular phase post-bleeding before ovulation", () => {
  const starts = ["2026-05-01", "2026-05-29"];
  const bleeds = [{ start: "2026-05-01", end: "2026-05-05", days: 5 }];

  // Day 8 is May 8
  const res = determineEntryPhase("2026-05-08", starts, bleeds);
  assert.equal(res.phaseSlug, "follicular");
  assert.equal(res.cycleDay, 8);
});

test("analyzeSymptomCorrelations: empty entries returns graceful empty state", () => {
  const res = analyzeSymptomCorrelations([]);
  assert.equal(res.totalSymptomsLogged, 0);
  assert.equal(res.correlations.length, 0);
  assert.equal(res.hasSufficientData, false);
});

test("analyzeSymptomCorrelations: calculates recurring pre-menstrual pattern across 4 cycles", () => {
  // Setup 4 cycles:
  // Cycle 0: 2026-01-01 to 2026-01-29 (28d)
  // Cycle 1: 2026-01-29 to 2026-02-26 (28d)
  // Cycle 2: 2026-02-26 to 2026-03-26 (28d)
  // Cycle 3: 2026-03-26 to 2026-04-23 (28d)
  const entries = [
    { type: "period", title: "Period started", date: "2026-01-01" },
    { type: "period", title: "Period ended", date: "2026-01-05" },
    { type: "symptom", title: "Lower energy", date: "2026-01-26" }, // 3d before Jan 29

    { type: "period", title: "Period started", date: "2026-01-29" },
    { type: "period", title: "Period ended", date: "2026-02-02" },
    { type: "symptom", title: "Lower energy", date: "2026-02-24" }, // 2d before Feb 26

    { type: "period", title: "Period started", date: "2026-02-26" },
    { type: "period", title: "Period ended", date: "2026-03-02" },
    { type: "symptom", title: "Lower energy", date: "2026-03-23" }, // 3d before Mar 26

    { type: "period", title: "Period started", date: "2026-03-26" },
    { type: "period", title: "Period ended", date: "2026-03-30" },

    // Headache isolated to 1 cycle (mid-cycle)
    { type: "symptom", title: "Headache", date: "2026-02-12" },
  ];

  const analysis = analyzeSymptomCorrelations(entries);

  assert.equal(analysis.totalCyclesObserved, 4);
  assert.equal(analysis.correlations.length, 2);

  const lowerEnergy = analysis.correlations.find(
    (c) => c.name === "Lower energy",
  );
  assert.ok(lowerEnergy);
  assert.equal(lowerEnergy.totalOccurrences, 3);
  assert.equal(lowerEnergy.cyclesWithSymptom, 3);
  assert.equal(lowerEnergy.totalCyclesObserved, 4);
  // Recurred in 3 of 4 cycles = 75%
  assert.equal(lowerEnergy.cycleRecurrenceRate, 75);
  assert.equal(lowerEnergy.dominantPhase.slug, "pre-menstrual");
  assert.equal(lowerEnergy.dominantPhase.cyclesInPhase, 3);
  assert.equal(lowerEnergy.dominantPhase.phaseRecurrenceRate, 75);
  assert.equal(lowerEnergy.isConsistentRecurrence, true);
  assert.ok(
    lowerEnergy.patternClassification.includes(
      "Consistent Pre-menstrual recurrence",
    ),
  );
  assert.ok(
    lowerEnergy.clinicalSummary.includes(
      "Observed in 3 of 4 recorded cycles (75% recurrence)",
    ),
  );

  const headache = analysis.correlations.find((c) => c.name === "Headache");
  assert.ok(headache);
  assert.equal(headache.cyclesWithSymptom, 1);
  assert.equal(headache.cycleRecurrenceRate, 25);
  assert.equal(headache.patternClassification, "Isolated to 1 cycle");
});

test("filterCorrelations: filters by dominant phase slug", () => {
  const correlations = [
    { name: "Cramps", dominantPhase: { slug: "menstrual" } },
    { name: "Fatigue", dominantPhase: { slug: "pre-menstrual" } },
    { name: "Ovulation pain", dominantPhase: { slug: "mid-cycle" } },
  ];

  const filtered = filterCorrelations(correlations, "pre-menstrual");
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].name, "Fatigue");

  const all = filterCorrelations(correlations, "all");
  assert.equal(all.length, 3);
});

test("buildSymptomCycleMatrix: generates matrix cells correctly", () => {
  const starts = ["2026-01-01", "2026-01-29", "2026-02-26"];
  const correlations = [
    {
      name: "Pelvic discomfort",
      dominantPhase: { slug: "menstrual" },
      cycleRecurrenceRate: 67,
      cyclesWithSymptom: 2,
      phaseInfos: [
        { cycleIndex: 0, phaseSlug: "menstrual" },
        { cycleIndex: 2, phaseSlug: "menstrual" },
      ],
    },
  ];

  const matrix = buildSymptomCycleMatrix(correlations, starts);
  assert.equal(matrix.length, 1);
  assert.equal(matrix[0].cycleCells.length, 3);
  assert.equal(matrix[0].cycleCells[0].present, true);
  assert.equal(matrix[0].cycleCells[1].present, false);
  assert.equal(matrix[0].cycleCells[2].present, true);
});
