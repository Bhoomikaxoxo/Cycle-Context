import { RULES } from "./rules.config.js";
export { RULES };

const DAY = 86400000;

// Parse "YYYY-MM-DD" as UTC midnight so DST never shifts day counts.
export const parseDay = (s) => {
  const [y, m, d] = s.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};
export const daysBetween = (a, b) => Math.round((parseDay(b) - parseDay(a)) / DAY);

const isEvent = (e, event) => {
  if (e.type !== "period") return false;
  if (e.event === event) return true;
  if (event === "started" && (e.periodRole === "start" || e.title === "Period started")) return true;
  if (event === "ended" && (e.periodRole === "end" || e.title === "Period ended")) return true;
  return false;
};

const byEvent = (entries, event) =>
  [...new Set(entries.filter((e) => isEvent(e, event)).map((e) => e.date))].sort();

export function getCycles(entries) {
  const starts = byEvent(entries, "started");
  return starts.slice(1).map((s, i) => ({
    from: starts[i], to: s, length: daysBetween(starts[i], s),
  }));
}

// Pairs each start with the first end on/after it and before the next start.
// Duration is inclusive (start day counts as day 1).
export function getBleedingDurations(entries) {
  const starts = byEvent(entries, "started");
  const ends = byEvent(entries, "ended");
  return starts.flatMap((s, i) => {
    const next = starts[i + 1] ?? "9999-12-31";
    const end = ends.find((e) => e >= s && e < next);
    return end ? [{ start: s, end, days: daysBetween(s, end) + 1 }] : [];
  });
}

export function confidenceFor(cycleCount, rules = RULES) {
  return rules.confidence.find((c) => cycleCount >= c.minCycles).level;
}

const median = (a) => {
  const s = [...a].sort((x, y) => x - y), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function comparePopulation(cycles, population = RULES.population) {
  if (!cycles || !cycles.length || !population) return null;
  const lens = cycles.map((c) => (typeof c === "number" ? c : c.length));
  const userMedian = median(lens);
  const userMin = Math.min(...lens);
  const userMax = Math.max(...lens);
  const userSpread = userMax - userMin;
  const { cycleLength, cycleVariation, source, sampleSize } = population;

  let band = "middle50";
  let bandLabel = "Within the middle 50% of cycles (27–31 days)";
  let percentileEstimate = "25th–75th percentile";

  if (userMedian < cycleLength.middle90.min) {
    band = "shorter-90";
    bandLabel = `Shorter than 90% of cycles (<${cycleLength.middle90.min} days)`;
    percentileEstimate = "< 5th percentile";
  } else if (userMedian > cycleLength.middle90.max) {
    band = "longer-90";
    bandLabel = `Longer than 90% of cycles (>${cycleLength.middle90.max} days)`;
    percentileEstimate = "> 95th percentile";
  } else if (userMedian < cycleLength.middle50.min) {
    band = "shorter-50";
    bandLabel = `Between 5th and 25th percentiles (${cycleLength.middle90.min}–${cycleLength.middle50.min - 1} days)`;
    percentileEstimate = "5th–25th percentile";
  } else if (userMedian > cycleLength.middle50.max) {
    band = "longer-50";
    bandLabel = `Between 75th and 95th percentiles (${cycleLength.middle50.max + 1}–${cycleLength.middle90.max} days)`;
    percentileEstimate = "75th–95th percentile";
  }

  const variationComparison = lens.length >= 2 ? {
    userSpread,
    typicalSpread: cycleVariation.typicalSpread,
    highSpreadThreshold: cycleVariation.highSpreadThreshold,
    isTypical: userSpread <= cycleVariation.highSpreadThreshold,
    pctUnderThreshold: cycleVariation.pctUsersUnder9DaysSpread,
    message: userSpread <= cycleVariation.highSpreadThreshold
      ? `Your cycle spread of ${userSpread} days aligns with typical individual variation (≤${cycleVariation.highSpreadThreshold} days in ~${cycleVariation.pctUsersUnder9DaysSpread}% of users).`
      : `Your cycle spread of ${userSpread} days is higher than the ${cycleVariation.highSpreadThreshold}-day threshold observed in ~${cycleVariation.pctUsersUnder9DaysSpread}% of study participants.`
  } : null;

  return {
    source,
    sampleSize,
    userMedian,
    userMin,
    userMax,
    userSpread,
    populationMedian: cycleLength.median,
    populationMean: cycleLength.mean,
    middle50: cycleLength.middle50,
    middle90: cycleLength.middle90,
    distribution: cycleLength.distribution,
    band,
    bandLabel,
    percentileEstimate,
    variationComparison,
    narrative: `Your median cycle length is ${userMedian} days. In published population research (${source}), the median is ${cycleLength.median} days, 50% of cycles fall between ${cycleLength.middle50.min} and ${cycleLength.middle50.max} days, and 90% fall between ${cycleLength.middle90.min} and ${cycleLength.middle90.max} days.`,
    note: "Comparison based on aggregated published study data (Bull et al., 2019). Reflects population statistical distribution, not a clinical target or personal diagnosis."
  };
}

export function analyze(entries, { today, rules = RULES } = {}) {
  const t = rules.thresholds;
  const cycles = getCycles(entries).slice(-rules.window);
  const bleeds = getBleedingDurations(entries).slice(-rules.window);
  const confidence = confidenceFor(cycles.length, rules);
  const flags = [];
  const mk = (id, title, message, evidence, rule) =>
    flags.push({ id, title, message, evidence, rule, confidence, rulesVersion: rules.version });

  if (cycles.length >= rules.minCyclesForFlag) {
    const long = cycles.filter((c) => c.length > t.cycleLengthDays.max);
    const short = cycles.filter((c) => c.length < t.cycleLengthDays.min);
    if (long.length >= rules.minOutOfRange)
      mk("long_cycles", "Longer cycles than the typical range",
        `${long.length} of your last ${cycles.length} cycles were longer than ${t.cycleLengthDays.max} days. Worth mentioning at an appointment.`,
        { cycles: long }, t.cycleLengthDays);
    if (short.length >= rules.minOutOfRange)
      mk("short_cycles", "Shorter cycles than the typical range",
        `${short.length} of your last ${cycles.length} cycles were shorter than ${t.cycleLengthDays.min} days. Worth mentioning at an appointment.`,
        { cycles: short }, t.cycleLengthDays);
  }

  if (cycles.length >= rules.minCyclesForVariation) {
    const lens = cycles.map((c) => c.length);
    const spread = Math.max(...lens) - Math.min(...lens);
    if (spread > t.cycleVariationDays.max)
      mk("variable_cycles", "Cycle length varies a lot",
        `Your shortest and longest recent cycles differ by ${spread} days (typical is up to ${t.cycleVariationDays.max}).`,
        { shortest: Math.min(...lens), longest: Math.max(...lens), spread }, t.cycleVariationDays);
  }

  const longBleeds = bleeds.filter((b) => b.days > t.bleedingDurationDays.max);
  if (bleeds.length >= rules.minCyclesForFlag && longBleeds.length >= rules.minOutOfRange)
    mk("long_bleeding", "Longer bleeding than the typical range",
      `${longBleeds.length} of your last ${bleeds.length} recorded periods lasted more than ${t.bleedingDurationDays.max} days.`,
      { periods: longBleeds }, t.bleedingDurationDays);

  const starts = byEvent(entries, "started");
  if (today && starts.length) {
    const gap = daysBetween(starts.at(-1), today);
    if (gap > t.daysSinceLastStart.max)
      mk("long_gap", "A long time since your last recorded period start",
        `It has been ${gap} days since the last start you logged. This may also mean entries are missing.`,
        { lastStart: starts.at(-1), gap }, t.daysSinceLastStart);
  }

  const lens = cycles.map((c) => c.length);
  const populationComparison = cycles.length >= rules.minCyclesForFlag
    ? comparePopulation(cycles, rules.population)
    : null;

  return {
    rulesVersion: rules.version,
    confidence,
    basedOnCycles: cycles.length,
    summary: lens.length
      ? {
          median: median(lens),
          min: Math.min(...lens),
          max: Math.max(...lens),
          spread: Math.max(...lens) - Math.min(...lens)
        }
      : null, // show a dash + what's needed, as the walkthrough describes
    flags,
    populationComparison,
  };
}
