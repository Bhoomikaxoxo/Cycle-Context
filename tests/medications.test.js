import test from "node:test";
import assert from "node:assert/strict";
import {
  COMMON_MEDICATION_PRESETS,
  calculateRegimenDuration,
  formatRegimenLine,
  filterMedicationsByWindow,
  filterMedicationsByStatus,
} from "../src/modules/medications.js";

test("COMMON_MEDICATION_PRESETS provides expected clinical & nutritional entries", () => {
  assert.ok(Array.isArray(COMMON_MEDICATION_PRESETS));
  assert.ok(COMMON_MEDICATION_PRESETS.length >= 8);
  const names = COMMON_MEDICATION_PRESETS.map((p) => p.name);
  assert.ok(names.includes("Myo-Inositol"));
  assert.ok(names.includes("Metformin"));
  assert.ok(names.includes("Levothyroxine"));
  assert.ok(names.includes("Vitamin D3"));
});

test("calculateRegimenDuration computes active duration accurately", () => {
  const asOf = "2026-10-14";
  const res1 = calculateRegimenDuration("2026-10-14", null, asOf);
  assert.equal(res1.days, 0);
  assert.equal(res1.durationText, "Started today");
  assert.equal(res1.isActive, true);

  const res2 = calculateRegimenDuration("2026-10-04", null, asOf);
  assert.equal(res2.days, 10);
  assert.equal(res2.isActive, true);
  assert.ok(res2.label.includes("Active · 10 days"));

  const res3 = calculateRegimenDuration("2026-07-16", null, asOf);
  assert.equal(res3.days, 90);
  assert.equal(res3.isActive, true);
  assert.ok(res3.durationText.includes("90 days"));
});

test("calculateRegimenDuration computes completed duration when endDate is present", () => {
  const asOf = "2026-10-14";
  const res = calculateRegimenDuration("2026-05-01", "2026-06-01", asOf);
  assert.equal(res.days, 31);
  assert.equal(res.isActive, false);
  assert.ok(res.label.includes("Completed · 31 days"));
});

test("formatRegimenLine outputs clean clinical summary line", () => {
  const med = {
    name: "Metformin",
    dosage: "500 mg",
    frequency: "Once daily with dinner",
    startDate: "2026-08-01",
    endDate: null,
    status: "active",
    notes: "Prescribed for insulin sensitivity",
  };
  const line = formatRegimenLine(med, "2026-10-14");
  assert.ok(line.includes("• Metformin (500 mg, Once daily with dinner)"));
  assert.ok(line.includes("[Active] Since 2026-08-01"));
  assert.ok(line.includes("Prescribed for insulin sensitivity"));
});

test("filterMedicationsByWindow filters by date overlap", () => {
  const list = [
    { name: "Med A", startDate: "2026-01-01", endDate: "2026-03-31" }, // completely before
    { name: "Med B", startDate: "2026-05-01", endDate: "2026-07-31" }, // overlaps
    { name: "Med C", startDate: "2026-08-01", endDate: null }, // active ongoing
    { name: "Med D", startDate: "2026-11-01", endDate: null }, // in the future
  ];

  const inWindow = filterMedicationsByWindow(list, "2026-06-01", "2026-09-30");
  const matchedNames = inWindow.map((m) => m.name);
  assert.deepEqual(matchedNames, ["Med B", "Med C"]);
});

test("filterMedicationsByStatus returns regimens matching status", () => {
  const list = [
    { name: "A", status: "active" },
    { name: "B", status: "paused" },
    { name: "C", status: "completed" },
  ];
  assert.equal(filterMedicationsByStatus(list, "active").length, 1);
  assert.equal(filterMedicationsByStatus(list, "paused").length, 1);
  assert.equal(filterMedicationsByStatus(list, "all").length, 3);
});
