// symptom-correlation.js
// Client-side, non-causal cycle phase correlation and recurrence analyzer for symptoms.
// Calculates objective cycle-level recurrence rates and phase distributions with clear sample-size indicators.

import { parseDay, daysBetween } from './analysis.js';
export { parseDay, daysBetween };

export const PHASE_CONFIG = {
  menstrual: {
    slug: 'menstrual',
    name: 'Menstrual phase',
    shortName: 'Menstrual',
    badgeClass: 'phase-menstrual',
    description: 'During active period bleeding'
  },
  follicular: {
    slug: 'follicular',
    name: 'Follicular phase',
    shortName: 'Follicular',
    badgeClass: 'phase-follicular',
    description: 'Post-bleeding to pre-ovulatory'
  },
  'mid-cycle': {
    slug: 'mid-cycle',
    name: 'Mid-cycle / Ovulatory',
    shortName: 'Mid-cycle',
    badgeClass: 'phase-mid-cycle',
    description: 'Approximate ovulatory window (~midpoint)'
  },
  luteal: {
    slug: 'luteal',
    name: 'Luteal phase',
    shortName: 'Luteal',
    badgeClass: 'phase-luteal',
    description: 'Post-ovulatory prior to late luteal window'
  },
  'pre-menstrual': {
    slug: 'pre-menstrual',
    name: 'Pre-menstrual (Late luteal)',
    shortName: 'Pre-menstrual',
    badgeClass: 'phase-pre-menstrual',
    description: '1–7 days before period onset'
  },
  unlinked: {
    slug: 'unlinked',
    name: 'Unlinked',
    shortName: 'Unlinked',
    badgeClass: 'phase-unlinked',
    description: 'Outside recorded cycle boundaries'
  }
};

/**
 * Determine the cycle and phase for a specific date given cycle boundaries and bleeding durations.
 */
export function determineEntryPhase(dateStr, starts = [], bleeds = [], averageCycleLength = 29) {
  if (!starts.length) {
    return {
      phaseSlug: 'unlinked',
      phaseName: PHASE_CONFIG.unlinked.name,
      cycleIndex: null,
      cycleDay: null,
      daysBeforeNext: null,
      percentage: 50
    };
  }

  const sortedStarts = [...new Set(starts)].sort();
  const eDay = parseDay(dateStr);

  // Find preceding start
  let prevStartIndex = -1;
  for (let i = sortedStarts.length - 1; i >= 0; i--) {
    if (parseDay(sortedStarts[i]) <= eDay) {
      prevStartIndex = i;
      break;
    }
  }

  if (prevStartIndex === -1) {
    // Date is before any recorded start
    return {
      phaseSlug: 'unlinked',
      phaseName: PHASE_CONFIG.unlinked.name,
      cycleIndex: null,
      cycleDay: null,
      daysBeforeNext: null,
      percentage: 0
    };
  }

  const startDate = sortedStarts[prevStartIndex];
  const nextStartDate = sortedStarts[prevStartIndex + 1] || null;
  const cycleDay = daysBetween(startDate, dateStr) + 1; // 1-based

  // Find bleeding duration for this cycle if recorded
  const cycleBleed = bleeds.find(b => b.start === startDate);
  const bleedDays = cycleBleed ? cycleBleed.days : 5;

  let daysBeforeNext = null;
  let cycleLength = nextStartDate ? daysBetween(startDate, nextStartDate) : averageCycleLength;

  if (nextStartDate) {
    daysBeforeNext = daysBetween(dateStr, nextStartDate);
  }

  // Calculate percentage within cycle for visualization
  const percentage = Math.min(100, Math.max(0, Math.round((cycleDay / Math.max(1, cycleLength)) * 100)));

  // Phase categorization logic:
  // 1. Menstrual phase: Day 1 through end of recorded bleeding (or Day 5 default)
  if (cycleDay <= bleedDays) {
    return {
      phaseSlug: 'menstrual',
      phaseName: `Menstrual phase (Days 1–${bleedDays})`,
      cycleIndex: prevStartIndex,
      cycleDay,
      daysBeforeNext,
      percentage,
      startDate,
      nextStartDate
    };
  }

  // 2. Pre-menstrual (Late luteal): 1 to 7 days before next period start,
  // or Day 22+ if next period not yet recorded
  if (daysBeforeNext !== null && daysBeforeNext <= 7 && daysBeforeNext >= 1) {
    return {
      phaseSlug: 'pre-menstrual',
      phaseName: daysBeforeNext <= 3
        ? `Pre-menstrual (${daysBeforeNext}d before bleeding)`
        : `Late luteal / Pre-menstrual (${daysBeforeNext}d before)`,
      cycleIndex: prevStartIndex,
      cycleDay,
      daysBeforeNext,
      percentage,
      startDate,
      nextStartDate
    };
  }

  if (!nextStartDate && cycleDay >= 22) {
    return {
      phaseSlug: 'pre-menstrual',
      phaseName: `Late luteal / Pre-menstrual (Day ${cycleDay})`,
      cycleIndex: prevStartIndex,
      cycleDay,
      daysBeforeNext: null,
      percentage,
      startDate,
      nextStartDate
    };
  }

  // 3. Mid-cycle / Ovulatory: Approximate window around cycle midpoint (typically length - 14 ± 2 days)
  const estMidpoint = Math.max(bleedDays + 3, Math.round(cycleLength - 14));
  const ovStart = Math.max(bleedDays + 1, estMidpoint - 2);
  const ovEnd = estMidpoint + 2;

  if (cycleDay >= ovStart && cycleDay <= ovEnd) {
    return {
      phaseSlug: 'mid-cycle',
      phaseName: `Mid-cycle / Ovulatory (Days ${ovStart}–${ovEnd})`,
      cycleIndex: prevStartIndex,
      cycleDay,
      daysBeforeNext,
      percentage,
      startDate,
      nextStartDate
    };
  }

  // 4. Follicular phase: Between menstrual end and ovulatory window
  if (cycleDay < ovStart) {
    return {
      phaseSlug: 'follicular',
      phaseName: `Follicular phase (Days ${bleedDays + 1}–${ovStart - 1})`,
      cycleIndex: prevStartIndex,
      cycleDay,
      daysBeforeNext,
      percentage,
      startDate,
      nextStartDate
    };
  }

  // 5. Luteal phase: Between ovulatory window and pre-menstrual window
  return {
    phaseSlug: 'luteal',
    phaseName: `Luteal phase (Cycle Day ${cycleDay})`,
    cycleIndex: prevStartIndex,
    cycleDay,
    daysBeforeNext,
    percentage,
    startDate,
    nextStartDate
  };
}

/**
 * Analyze recurrence and phase distribution of symptoms across all recorded cycles.
 * Returns structured metrics with transparent denominators (e.g., 3 of 4 cycles).
 */
export function analyzeSymptomCorrelations(entries = [], options = {}) {
  const isPeriodStart = (e) =>
    e.type === 'period' && (e.event === 'started' || e.periodRole === 'start' || e.title === 'Period started');
  const isPeriodEnd = (e) =>
    e.type === 'period' && (e.event === 'ended' || e.periodRole === 'end' || e.title === 'Period ended');

  const starts = [...new Set(entries.filter(isPeriodStart).map(e => e.date))].sort();
  const ends = [...new Set(entries.filter(isPeriodEnd).map(e => e.date))].sort();

  // Bleeding durations
  const bleeds = starts.flatMap((s, i) => {
    const next = starts[i + 1] ?? '9999-12-31';
    const end = ends.find(e => e >= s && e < next);
    return end ? [{ start: s, end, days: daysBetween(s, end) + 1 }] : [];
  });

  // Completed cycle intervals
  const completedCycles = starts.slice(1).map((s, i) => ({
    cycleIndex: i,
    start: starts[i],
    end: s,
    length: daysBetween(starts[i], s)
  }));

  const averageCycleLength = completedCycles.length
    ? Math.round(completedCycles.reduce((sum, c) => sum + c.length, 0) / completedCycles.length)
    : 29;

  // Total cycles available for observation
  // (Completed cycles + ongoing cycle if it started)
  const totalCyclesCount = starts.length > 0 ? starts.length : 0;

  // Extract all symptoms
  const symptomEntries = entries.filter(e => e.type === 'symptom' && e.title && e.title.trim());

  if (!symptomEntries.length) {
    return {
      totalSymptomsLogged: 0,
      totalCyclesObserved: totalCyclesCount,
      completedCyclesCount: completedCycles.length,
      correlations: [],
      hasSufficientData: totalCyclesCount >= 2
    };
  }

  // Group symptoms by name (case-insensitive)
  const symptomGroups = new Map();

  symptomEntries.forEach(entry => {
    const rawName = entry.title.trim();
    const key = rawName.toLowerCase();
    const phaseInfo = determineEntryPhase(entry.date, starts, bleeds, averageCycleLength);

    if (!symptomGroups.has(key)) {
      symptomGroups.set(key, {
        name: rawName,
        key,
        entries: [],
        phaseInfos: [],
        cyclesSet: new Set(),
        phasesSet: new Set(),
        phaseCycleMap: new Map() // phaseSlug -> Set of cycleIndices
      });
    }

    const group = symptomGroups.get(key);
    group.entries.push(entry);
    group.phaseInfos.push(phaseInfo);

    if (phaseInfo.cycleIndex !== null) {
      group.cyclesSet.add(phaseInfo.cycleIndex);

      if (!group.phaseCycleMap.has(phaseInfo.phaseSlug)) {
        group.phaseCycleMap.set(phaseInfo.phaseSlug, new Set());
      }
      group.phaseCycleMap.get(phaseInfo.phaseSlug).add(phaseInfo.cycleIndex);
    }
    group.phasesSet.add(phaseInfo.phaseSlug);
  });

  // Calculate correlation metrics for each symptom
  const correlations = [...symptomGroups.values()].map(group => {
    const totalOccurrences = group.entries.length;
    const cyclesWithSymptom = group.cyclesSet.size;
    const denominator = Math.max(1, totalCyclesCount);

    const cycleRecurrenceRate = totalCyclesCount > 0
      ? Math.round((cyclesWithSymptom / denominator) * 100)
      : 0;

    // Phase distribution calculations
    const phaseBreakdown = Object.keys(PHASE_CONFIG).map(slug => {
      const occurrences = group.phaseInfos.filter(p => p.phaseSlug === slug).length;
      const cyclesInPhase = group.phaseCycleMap.has(slug)
        ? group.phaseCycleMap.get(slug).size
        : 0;
      const phaseRecurrenceRate = totalCyclesCount > 0
        ? Math.round((cyclesInPhase / denominator) * 100)
        : 0;

      return {
        slug,
        name: PHASE_CONFIG[slug].name,
        shortName: PHASE_CONFIG[slug].shortName,
        badgeClass: PHASE_CONFIG[slug].badgeClass,
        occurrences,
        cyclesInPhase,
        phaseRecurrenceRate,
        percentOfOccurrences: totalOccurrences > 0 ? Math.round((occurrences / totalOccurrences) * 100) : 0
      };
    }).filter(p => p.occurrences > 0);

    // Dominant phase (phase with most cycles, then most occurrences)
    const sortedPhases = [...phaseBreakdown].sort((a, b) =>
      b.cyclesInPhase - a.cyclesInPhase || b.occurrences - a.occurrences
    );
    const dominantPhase = sortedPhases[0] || null;

    // Pattern classification
    let patternClassification = 'Variable / Non-clustered';
    let isConsistentRecurrence = false;

    if (totalCyclesCount < 2) {
      patternClassification = 'Single cycle observation';
    } else if (dominantPhase && dominantPhase.phaseRecurrenceRate >= 60 && dominantPhase.cyclesInPhase >= 2) {
      patternClassification = `Consistent ${dominantPhase.shortName} recurrence`;
      isConsistentRecurrence = true;
    } else if (dominantPhase && dominantPhase.phaseRecurrenceRate >= 40 && dominantPhase.cyclesInPhase >= 2) {
      patternClassification = `Emerging ${dominantPhase.shortName} pattern`;
    } else if (cycleRecurrenceRate >= 60 && cyclesWithSymptom >= 2) {
      patternClassification = 'Frequent cyclic occurrence';
    } else if (cyclesWithSymptom === 1 && totalCyclesCount >= 2) {
      patternClassification = 'Isolated to 1 cycle';
    }

    // Sample size confidence level
    let confidence = 'preliminary';
    if (totalCyclesCount >= 3 && cyclesWithSymptom >= 2) {
      confidence = 'established';
    } else if (totalCyclesCount >= 2) {
      confidence = 'moderate';
    }

    // Clinical summary statement (strictly non-causal, objective)
    let clinicalSummary = '';
    if (totalCyclesCount >= 2) {
      const cyclePhrase = `Observed in ${cyclesWithSymptom} of ${totalCyclesCount} recorded cycle${totalCyclesCount === 1 ? '' : 's'} (${cycleRecurrenceRate}% recurrence)`;
      const phasePhrase = dominantPhase && dominantPhase.slug !== 'unlinked'
        ? `, most frequently during the ${dominantPhase.name.toLowerCase()} (${dominantPhase.cyclesInPhase} cycle${dominantPhase.cyclesInPhase === 1 ? '' : 's'})`
        : '';
      clinicalSummary = `${cyclePhrase}${phasePhrase}.`;
    } else {
      clinicalSummary = `Logged ${totalOccurrences} time${totalOccurrences === 1 ? '' : 's'} across ${cyclesWithSymptom} recorded cycle.`;
    }

    return {
      name: group.name,
      key: group.key,
      totalOccurrences,
      cyclesWithSymptom,
      totalCyclesObserved: totalCyclesCount,
      cycleRecurrenceRate,
      phaseBreakdown,
      dominantPhase,
      patternClassification,
      isConsistentRecurrence,
      confidence,
      clinicalSummary,
      entries: group.entries,
      phaseInfos: group.phaseInfos
    };
  });

  // Sort by recurrence rate (highest first), then by total occurrences
  correlations.sort((a, b) => b.cycleRecurrenceRate - a.cycleRecurrenceRate || b.totalOccurrences - a.totalOccurrences);

  return {
    totalSymptomsLogged: symptomEntries.length,
    totalCyclesObserved: totalCyclesCount,
    completedCyclesCount: completedCycles.length,
    correlations,
    hasSufficientData: totalCyclesCount >= 2,
    hasConsistentPatterns: correlations.some(c => c.isConsistentRecurrence),
    disclaimer: 'Symptom timing and phase recurrence reflect your personal logs. Cycle Context does not infer medical cause or make diagnostic assertions.'
  };
}

/**
 * Filter correlations by phase or search term.
 */
export function filterCorrelations(correlations = [], phaseFilter = 'all') {
  if (!phaseFilter || phaseFilter === 'all') return correlations;
  return correlations.filter(c =>
    c.dominantPhase && c.dominantPhase.slug === phaseFilter
  );
}

/**
 * Generate a cycle-by-cycle recurrence matrix for table or grid rendering.
 */
export function buildSymptomCycleMatrix(correlations = [], starts = []) {
  if (!correlations.length || !starts.length) return [];

  return correlations.map(c => {
    const cycleCells = starts.map((s, idx) => {
      const infosInCycle = c.phaseInfos.filter(p => p.cycleIndex === idx);
      if (!infosInCycle.length) {
        return { cycleIndex: idx, present: false, phases: [] };
      }
      return {
        cycleIndex: idx,
        present: true,
        count: infosInCycle.length,
        phases: [...new Set(infosInCycle.map(p => p.phaseSlug))]
      };
    });

    return {
      name: c.name,
      dominantPhase: c.dominantPhase,
      cycleRecurrenceRate: c.cycleRecurrenceRate,
      cyclesWithSymptom: c.cyclesWithSymptom,
      totalCycles: starts.length,
      cycleCells
    };
  });
}
