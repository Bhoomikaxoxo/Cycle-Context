// Single source of truth for thresholds. Change values HERE, bump `version`,
// and add a line to CHANGELOG.md with the source.
// All thresholds marked verify:true must be checked against the cited source
// (ideally by a clinician) before shipping.

export const RULES = {
  version: "0.1.0",

  // Only the most recent N cycles are considered.
  window: 6,

  // Minimum cycles before any flag may fire / before variation is judged.
  minCyclesForFlag: 2,
  minCyclesForVariation: 3,

  // A flag fires when at least this many cycles in the window are out of range.
  minOutOfRange: 2,

  confidence: [
    // first matching row wins (checked top to bottom by minCycles, descending)
    { minCycles: 12, level: "higher" },
    { minCycles: 6, level: "moderate" },
    { minCycles: 3, level: "low" },
    { minCycles: 0, level: "insufficient" },
  ],

  thresholds: {
    cycleLengthDays: {
      min: 24, max: 38,
      source: "FIGO 2018 normal uterine bleeding criteria (frequency)",
      verify: true,
    },
    cycleVariationDays: {
      max: 9, // shortest-to-longest cycle in window
      source: "FIGO 2018 (regularity; commonly cited as 7-9 days, age-dependent)",
      verify: true,
    },
    bleedingDurationDays: {
      max: 8,
      source: "FIGO 2018 (duration)",
      verify: true,
    },
    daysSinceLastStart: {
      max: 90,
      source: "Common clinical threshold for missed periods (~3 months)",
      verify: true,
    },
  },
};
