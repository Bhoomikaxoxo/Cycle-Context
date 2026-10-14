/**
 * Cycle Context - Clinical Brief Visuals & Executive Summary
 * Modular utilities for SVG cycle sparklines, executive clinical summaries,
 * and high-yield print formatting.
 *
 * Adheres to:
 * - Local-first, client-side zero-dependency computation.
 * - Monochrome & grayscale print-ready high-contrast visuals.
 * - Non-causal, objective descriptive statistics (FIGO 2018 & Bull et al. 2019 benchmarks).
 */

/**
 * Generate an SVG sparkline visualization of cycle intervals.
 * Displays:
 * - FIGO normal frequency band (24–38 days)
 * - Population median reference line (29.0 days, Bull et al. 2019)
 * - Individual cycle length bars / points with days and date labels
 * - Outlier markers for cycles >38d or <24d
 *
 * @param {Array<{start: {date: string}, end: {date: string}, days: number, bleedDays?: number}>} intervals
 * @param {Object} [options]
 * @returns {string} SVG markup string
 */
export function generateCycleSparklineSVG(intervals = [], options = {}) {
  const width = options.width || 680;
  const height = options.height || 140;
  const padLeft = 46;
  const padRight = 24;
  const padTop = 22;
  const padBottom = 32;

  if (!intervals || intervals.length === 0) {
    return `<svg class="brief-sparkline-svg empty" viewBox="0 0 ${width} ${height}" width="100%" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${width}" height="${height}" fill="#fcfcfb" rx="6" stroke="#e5e5df"/>
      <text x="${width / 2}" y="${height / 2 + 4}" text-anchor="middle" font-family="-apple-system, sans-serif" font-size="12" fill="#888">
        No completed cycle intervals in observation window (minimum 2 period starts needed)
      </text>
    </svg>`;
  }

  // Calculate scales
  const maxDaysObserved = Math.max(...intervals.map(i => i.days), 45);
  const minDaysObserved = Math.min(...intervals.map(i => i.days), 20);
  const yMax = Math.max(maxDaysObserved + 4, 50);
  const yMin = Math.max(0, Math.min(minDaysObserved - 4, 18));

  const chartWidth = width - padLeft - padRight;
  const chartHeight = height - padTop - padBottom;

  const yScale = (days) => {
    const clamped = Math.max(yMin, Math.min(yMax, days));
    return padTop + chartHeight - ((clamped - yMin) / (yMax - yMin)) * chartHeight;
  };

  // Normal range band: 24 to 38 days
  const yNormalTop = yScale(38);
  const yNormalBottom = yScale(24);
  const bandHeight = Math.max(2, yNormalBottom - yNormalTop);

  // Median line: 29 days
  const yMedian = yScale(29);

  // Layout cycle items horizontally
  const count = intervals.length;
  const slotWidth = chartWidth / count;
  const barWidth = Math.min(32, Math.max(14, slotWidth * 0.55));

  const items = intervals.map((inv, idx) => {
    const xCenter = padLeft + idx * slotWidth + slotWidth / 2;
    const yTop = yScale(inv.days);
    const barH = Math.max(4, yScale(yMin) - yTop);
    const isProlonged = inv.days > 38;
    const isShortened = inv.days < 24;
    const isNormal = !isProlonged && !isShortened;

    // Fill & stroke classes / colors for screen & print
    let barFill = '#735264'; // var(--plum)
    let strokeColor = '#503847';
    if (isProlonged) {
      barFill = '#b91c1c'; // deep red
      strokeColor = '#991b1b';
    } else if (isShortened) {
      barFill = '#c2410c'; // deep orange
      strokeColor = '#9a3412';
    }

    // Format short date label: e.g. "Jun 12"
    const startStr = inv.start?.date || '';
    let dateLabel = '';
    if (startStr) {
      const parts = startStr.split('-');
      if (parts.length === 3) {
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const mIdx = parseInt(parts[1], 10) - 1;
        dateLabel = `${monthNames[mIdx]} '${parts[0].slice(2)}`;
      }
    }

    return {
      xCenter,
      xLeft: xCenter - barWidth / 2,
      yTop,
      barH,
      days: inv.days,
      dateLabel,
      isProlonged,
      isShortened,
      isNormal,
      barFill,
      strokeColor
    };
  });

  // Polyline for connecting trend points
  const pointsString = items.map(i => `${i.xCenter},${i.yTop}`).join(' ');

  const barsMarkup = items.map(item => `
    <g class="sparkline-bar-group" data-days="${item.days}">
      <!-- Vertical guide to axis -->
      <line x1="${item.xCenter}" y1="${item.yTop}" x2="${item.xCenter}" y2="${padTop + chartHeight}" stroke="#d6d6ce" stroke-width="1" stroke-dasharray="2,2"/>
      <!-- Value bar -->
      <rect x="${item.xLeft}" y="${item.yTop}" width="${barWidth}" height="${item.barH}" rx="3" fill="${item.barFill}" stroke="${item.strokeColor}" stroke-width="1" class="cycle-bar ${item.isProlonged ? 'prolonged' : item.isShortened ? 'shortened' : 'normal'}"/>
      <!-- Cycle length value badge -->
      <text x="${item.xCenter}" y="${item.yTop - 6}" text-anchor="middle" font-family="-apple-system, sans-serif" font-size="11" font-weight="700" fill="${item.strokeColor}">
        ${item.days}d
      </text>
      <!-- Date label -->
      <text x="${item.xCenter}" y="${padTop + chartHeight + 16}" text-anchor="middle" font-family="-apple-system, sans-serif" font-size="9.5" fill="#666">
        ${item.dateLabel}
      </text>
    </g>
  `).join('');

  return `<svg class="brief-sparkline-svg" viewBox="0 0 ${width} ${height}" width="100%" height="${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Menstrual cycle lengths sparkline chart">
    <!-- Background -->
    <rect width="${width}" height="${height}" fill="#ffffff" rx="6" stroke="#e0e0da"/>

    <!-- FIGO Normal Range Corridor (24-38 days) -->
    <rect x="${padLeft}" y="${yNormalTop}" width="${chartWidth}" height="${bandHeight}" fill="#f0f7f2" stroke="#d5e8dc" stroke-width="1" stroke-dasharray="3,3" class="figo-normal-band"/>
    <text x="${padLeft + 6}" y="${yNormalTop + 12}" font-family="-apple-system, sans-serif" font-size="9" font-weight="600" fill="#2d6a4f">
      FIGO Normal Range (24–38 days)
    </text>

    <!-- Bull et al. 2019 Median Guideline (29.0d) -->
    <line x1="${padLeft}" y1="${yMedian}" x2="${padLeft + chartWidth}" y2="${yMedian}" stroke="#64748b" stroke-width="1" stroke-dasharray="4,4"/>
    <text x="${width - padRight - 4}" y="${yMedian - 3}" text-anchor="end" font-family="-apple-system, sans-serif" font-size="8.5" fill="#64748b">
      Median 29.0d (Bull et al.)
    </text>

    <!-- Y-axis reference labels -->
    <text x="${padLeft - 8}" y="${yScale(38) + 3}" text-anchor="end" font-family="-apple-system, sans-serif" font-size="9" fill="#555">38d</text>
    <text x="${padLeft - 8}" y="${yScale(24) + 3}" text-anchor="end" font-family="-apple-system, sans-serif" font-size="9" fill="#555">24d</text>
    <text x="${padLeft - 8}" y="${padTop + chartHeight}" text-anchor="end" font-family="-apple-system, sans-serif" font-size="8.5" fill="#888">${yMin}d</text>

    <!-- Trend line connecting cycle tops -->
    <polyline points="${pointsString}" fill="none" stroke="#735264" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" class="sparkline-trend-line"/>

    <!-- Cycle bars and labels -->
    ${barsMarkup}
  </svg>`;
}

/**
 * Build structured executive summary data for the top clinical overview block.
 *
 * @param {Object} params
 * @param {Object} params.analysis - Output of analyze()
 * @param {Array} params.intervals - Output of cycleIntervals()
 * @param {Array} params.durations - Output of bleedingDurations()
 * @param {Array} params.medications - Array of medication objects
 * @param {Array} params.questions - Active questions
 * @param {Array} params.documents - Confirmed documents
 * @returns {Object} Executive summary view model
 */
export function buildExecutiveSummaryData({
  analysis = {},
  intervals = [],
  durations = [],
  medications = [],
  questions = [],
  documents = []
} = {}) {
  // 1. Cycle Length & Frequency Status
  let freqCategory = 'Pending Data';
  let freqDetail = 'Need 2+ recorded period starts';
  let freqBadge = 'info';

  if (analysis.summary) {
    const min = analysis.summary.min;
    const max = analysis.summary.max;
    const median = analysis.summary.median;
    const count = analysis.basedOnCycles;

    if (min >= 24 && max <= 38) {
      freqCategory = 'Normal Cycle Frequency';
      freqDetail = `${min}–${max} days (median ${median}d, n=${count})`;
      freqBadge = 'normal';
    } else if (max > 38 && min < 24) {
      freqCategory = 'Highly Variable Frequency';
      freqDetail = `${min}–${max} days spanning short & long (median ${median}d, n=${count})`;
      freqBadge = 'attention';
    } else if (max > 38) {
      freqCategory = 'Infrequent / Extended Cycles';
      freqDetail = `${min}–${max} days with cycles >38d (median ${median}d, n=${count})`;
      freqBadge = 'attention';
    } else {
      freqCategory = 'Frequent / Shortened Cycles';
      freqDetail = `${min}–${max} days with cycles <24d (median ${median}d, n=${count})`;
      freqBadge = 'attention';
    }
  } else if (intervals.length) {
    const daysArr = intervals.map(i => i.days);
    const min = Math.min(...daysArr);
    const max = Math.max(...daysArr);
    freqCategory = 'Observed Frequency';
    freqDetail = `${min}–${max} days (${intervals.length} interval${intervals.length === 1 ? '' : 's'})`;
    freqBadge = 'info';
  }

  // 2. Regularity Spread
  let regularityCategory = 'Pending Data';
  let regularityDetail = 'Spread requires 2+ cycle intervals';
  let regularityBadge = 'info';

  if (analysis.summary) {
    const spread = analysis.summary.spread;
    if (spread <= 9) {
      regularityCategory = 'Regular Cycle Variation';
      regularityDetail = `±${spread} days spread (FIGO regular: ≤9 days)`;
      regularityBadge = 'normal';
    } else {
      regularityCategory = 'Elevated Cycle Variation';
      regularityDetail = `±${spread} days spread exceeding FIGO threshold (>9 days)`;
      regularityBadge = 'attention';
    }
  }

  // 3. Bleeding Duration
  let bleedCategory = 'Pending Data';
  let bleedDetail = 'Start and end dates needed';
  let bleedBadge = 'info';

  if (durations.length) {
    const bleedDays = durations.map(d => d.days);
    const minD = Math.min(...bleedDays);
    const maxD = Math.max(...bleedDays);
    const hasProlonged = maxD > 8;

    if (hasProlonged) {
      bleedCategory = 'Prolonged Bleeding Episode';
      bleedDetail = `${minD === maxD ? minD : `${minD}–${maxD}`} days (exceeds 8-day FIGO threshold)`;
      bleedBadge = 'attention';
    } else {
      bleedCategory = 'Normal Bleeding Duration';
      bleedDetail = `${minD === maxD ? minD : `${minD}–${maxD}`} days (within ≤8 days normal)`;
      bleedBadge = 'normal';
    }
  }

  // 4. Active Regimens
  const activeMeds = medications.filter(m => (m.status === 'active' || !m.status) && m.includeInSummary !== false);
  const activeMedsSummary = activeMeds.length
    ? activeMeds.map(m => `${m.name}${m.dosage ? ` (${m.dosage})` : ''}`).join(', ')
    : 'No active medications or supplements currently recorded';

  // 5. High-Yield Doctor Discussion Focus (top 2 active questions)
  const priorityQuestions = questions
    .filter(q => !q.disabled)
    .slice(0, 3)
    .map(q => q.text);

  // 6. Confirmed Lab Findings Highlights
  const labHighlights = documents
    .filter(d => d.includeInSummary && (d.keyFinding || d.notes))
    .slice(0, 3)
    .map(d => ({
      name: d.name,
      finding: d.keyFinding || d.notes,
      category: d.category || 'Lab'
    }));

  return {
    freqCategory,
    freqDetail,
    freqBadge,
    regularityCategory,
    regularityDetail,
    regularityBadge,
    bleedCategory,
    bleedDetail,
    bleedBadge,
    activeMedsCount: activeMeds.length,
    activeMedsSummary,
    priorityQuestions,
    labHighlights
  };
}

/**
 * Format date for print header (e.g. "14-Oct-2026")
 * @param {string} isoDate YYYY-MM-DD
 * @returns {string}
 */
export function formatClinicalDate(isoDate) {
  if (!isoDate) return '';
  const parts = isoDate.split('-');
  if (parts.length !== 3) return isoDate;
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const m = parseInt(parts[1], 10) - 1;
  return `${parts[2]}-${monthNames[m] || parts[1]}-${parts[0]}`;
}
