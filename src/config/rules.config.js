// Single source of truth for thresholds. Change values HERE, bump `version`,
// and add a line to CHANGELOG.md with the source.
// All thresholds marked verify:true must be checked against the cited source
// (ideally by a clinician) before shipping.

export const RULES = {
  version: "0.2.0",

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
      min: 24,
      max: 38,
      source: "FIGO 2018 normal uterine bleeding criteria (frequency)",
      verify: true,
    },
    cycleVariationDays: {
      max: 9, // shortest-to-longest cycle in window
      source:
        "FIGO 2018 (regularity; commonly cited as 7-9 days, age-dependent)",
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

  population: {
    source:
      "Bull et al. (2019), Real-world menstrual cycle characteristics of more than 600,000 menstrual cycles. npj Digital Medicine 2:83",
    sampleSize: "612,613 cycles (124,648 users)",
    verify: true,
    cycleLength: {
      mean: 29.3,
      median: 29.0,
      standardDeviation: 5.2,
      middle50: { min: 27, max: 31 }, // 25th - 75th percentile (IQR)
      middle90: { min: 23, max: 38 }, // 5th - 95th percentile
      // Binned percentage distribution (lengths 20 to 42 days)
      distribution: [
        { length: 21, percent: 1.0 },
        { length: 22, percent: 1.5 },
        { length: 23, percent: 2.2 },
        { length: 24, percent: 3.5 },
        { length: 25, percent: 5.2 },
        { length: 26, percent: 7.8 },
        { length: 27, percent: 11.0 },
        { length: 28, percent: 15.5 },
        { length: 29, percent: 14.8 },
        { length: 30, percent: 12.1 },
        { length: 31, percent: 8.5 },
        { length: 32, percent: 5.8 },
        { length: 33, percent: 3.9 },
        { length: 34, percent: 2.7 },
        { length: 35, percent: 1.9 },
        { length: 36, percent: 1.3 },
        { length: 37, percent: 0.9 },
        { length: 38, percent: 0.7 },
        { length: 39, percent: 0.5 },
        { length: 40, percent: 0.4 },
      ],
    },
    cycleVariation: {
      medianSpread: 2.5,
      typicalSpread: { min: 2, max: 4 },
      highSpreadThreshold: 9, // Spread > 9 days observed in < 10% of users
      pctUsersUnder9DaysSpread: 90.3,
    },
  },
};
