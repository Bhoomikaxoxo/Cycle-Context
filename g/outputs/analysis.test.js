import { test } from "node:test";
import assert from "node:assert/strict";
import { analyze } from "./analysis.js";

// Build period-start entries from a first date and a list of cycle lengths.
const starts = (first, lengths) => {
  const out = [first];
  let t = Date.parse(first + "T00:00:00Z");
  for (const l of lengths) { t += l * 86400000; out.push(new Date(t).toISOString().slice(0, 10)); }
  return out.map((date) => ({ type: "period", event: "started", date }));
};
const ids = (r) => r.flags.map((f) => f.id);

test("regular cycles: no flags, higher confidence with enough data", () => {
  const r = analyze(starts("2025-01-01", Array(12).fill(28)));
  assert.deepEqual(ids(r), []);
  assert.equal(r.confidence, "moderate"); // window caps at 6 cycles
});

test("too little data: no flags, insufficient confidence, null summary", () => {
  const r = analyze(starts("2025-01-01", []));
  assert.equal(r.confidence, "insufficient");
  assert.equal(r.summary, null);
  assert.deepEqual(ids(r), []);
});

test("one long cycle alone does not fire long_cycles (but variation may)", () => {
  const r = ids(analyze(starts("2025-01-01", [28, 45, 28, 28])));
  assert.ok(!r.includes("long_cycles"));
  assert.ok(r.includes("variable_cycles"));
});

test("repeated long cycles fire long_cycles with evidence", () => {
  const r = analyze(starts("2025-01-01", [45, 47, 44, 46]));
  assert.ok(ids(r).includes("long_cycles"));
  assert.equal(r.flags.find((f) => f.id === "long_cycles").evidence.cycles.length, 4);
});

test("repeated short cycles fire short_cycles", () => {
  assert.ok(ids(analyze(starts("2025-01-01", [20, 21, 22, 20]))).includes("short_cycles"));
});

test("high variation fires variable_cycles", () => {
  assert.ok(ids(analyze(starts("2025-01-01", [24, 38, 26, 40]))).includes("variable_cycles"));
});

test("long bleeding needs matched start/end pairs", () => {
  const e = [];
  for (const s of ["2025-01-01", "2025-01-29", "2025-02-26"]) {
    e.push({ type: "period", event: "started", date: s });
    const end = new Date(Date.parse(s + "T00:00:00Z") + 10 * 86400000).toISOString().slice(0, 10);
    e.push({ type: "period", event: "ended", date: end });
  }
  assert.ok(ids(analyze(e)).includes("long_bleeding"));
  assert.ok(!ids(analyze(e.filter((x) => x.event === "started"))).includes("long_bleeding"));
});

test("long gap since last start fires only when today is given", () => {
  const e = starts("2025-01-01", [28, 28]);
  assert.ok(!ids(analyze(e)).includes("long_gap"));
  assert.ok(ids(analyze(e, { today: "2025-09-01" })).includes("long_gap"));
});

test("supports app.js entry format with title/periodRole", () => {
  const appEntries = [
    { date: "2025-01-01", type: "period", title: "Period started" },
    { date: "2025-01-06", type: "period", title: "Period ended" },
    { date: "2025-02-15", type: "period", title: "Period started" }, // 45 days
    { date: "2025-03-31", type: "period", title: "Period started" }, // 44 days
  ];
  const r = analyze(appEntries);
  assert.ok(ids(r).includes("long_cycles"));
  assert.equal(r.summary.min, 44);
  assert.equal(r.summary.max, 45);
  assert.equal(r.summary.spread, 1);
});

test("population comparison: middle 50% band (27-31 days)", () => {
  const r = analyze(starts("2025-01-01", [28, 29, 29]));
  assert.ok(r.populationComparison);
  assert.equal(r.populationComparison.band, "middle50");
  assert.equal(r.populationComparison.userMedian, 29);
  assert.equal(r.populationComparison.populationMedian, 29);
  assert.ok(r.populationComparison.variationComparison.isTypical);
  assert.ok(r.populationComparison.source.includes("Bull et al."));
});

test("population comparison: longer-90 band (>38 days) and longer-50 band (32-38 days)", () => {
  const high = analyze(starts("2025-01-01", [40, 42]));
  assert.equal(high.populationComparison.band, "longer-90");
  assert.equal(high.populationComparison.percentileEstimate, "> 95th percentile");

  const midHigh = analyze(starts("2025-01-01", [34, 35]));
  assert.equal(midHigh.populationComparison.band, "longer-50");
  assert.equal(midHigh.populationComparison.percentileEstimate, "75th–95th percentile");
});

test("population comparison: shorter-90 band (<23 days) and shorter-50 band (23-26 days)", () => {
  const low = analyze(starts("2025-01-01", [20, 21]));
  assert.equal(low.populationComparison.band, "shorter-90");
  assert.equal(low.populationComparison.percentileEstimate, "< 5th percentile");

  const midLow = analyze(starts("2025-01-01", [24, 25]));
  assert.equal(midLow.populationComparison.band, "shorter-50");
  assert.equal(midLow.populationComparison.percentileEstimate, "5th–25th percentile");
});

test("population comparison: spread above 9 days highlights high variance against population", () => {
  const variable = analyze(starts("2025-01-01", [25, 38, 26]));
  assert.ok(variable.populationComparison);
  assert.equal(variable.populationComparison.variationComparison.isTypical, false);
  assert.equal(variable.populationComparison.variationComparison.userSpread, 13);
});

test("population comparison: insufficient data returns null", () => {
  const oneCycle = analyze(starts("2025-01-01", [28]));
  assert.equal(oneCycle.populationComparison, null);
});
