import { RULES, analyze } from './analysis.js';
import { parseVoiceEvents } from './extraction.js';

const CURRENT_SCHEMA_VERSION = 1;

const SAMPLE_ENTRIES = [
  { schemaVersion: CURRENT_SCHEMA_VERSION, date: '2026-09-06', type: 'period', title: 'Period started', detail: 'Flow: moderate' },
  { schemaVersion: CURRENT_SCHEMA_VERSION, date: '2026-08-26', type: 'symptom', title: 'Lower energy', detail: 'Noticed during the week before bleeding' },
  { schemaVersion: CURRENT_SCHEMA_VERSION, date: '2026-07-24', type: 'period', title: 'Period started', detail: 'Flow: light' },
  { schemaVersion: CURRENT_SCHEMA_VERSION, date: '2026-07-12', type: 'symptom', title: 'Pelvic discomfort', detail: 'Logged in evening' },
  { schemaVersion: CURRENT_SCHEMA_VERSION, date: '2026-06-08', type: 'period', title: 'Period started', detail: 'Flow: moderate' },
  { schemaVersion: CURRENT_SCHEMA_VERSION, date: '2026-05-14', type: 'context', title: 'Routine change', detail: 'Marked by you' },
  { schemaVersion: CURRENT_SCHEMA_VERSION, date: '2026-05-03', type: 'period', title: 'Period started', detail: 'Flow: moderate' },
  { schemaVersion: CURRENT_SCHEMA_VERSION, date: '2026-04-12', type: 'record', title: 'Clinician note', detail: 'Follow-up planned in three months' }
];

const ENTRY_KEY = 'cycleContextEntries';
const VOICE_KEY = 'cycleContextVoiceNotes';
const DOCUMENT_DB = 'cycle-context-private-records';
const DOCUMENT_STORE = 'documents';
const DOCUMENT_FILE_STORE = 'document-files';
const MAX_FILE_SIZE = 25 * 1024 * 1024;

let entries = readJSON(ENTRY_KEY, SAMPLE_ENTRIES);
let voiceNotes = readJSON(VOICE_KEY, []);
let currentType = 'period';
let voiceDraft = [];
let recognition = null;
let isRecording = false;
let documents = [];
let databasePromise;

const symptomTerms = [
  ['Cramps', ['cramps', 'cramp', 'crampy']],
  ['Pelvic discomfort', ['pelvic discomfort', 'pelvic pain']],
  ['Pain', ['pain', 'aching', 'ache', 'sore']],
  ['Headache', ['headache', 'migraine']],
  ['Lower energy', ['low energy', 'tired', 'fatigue', 'exhausted']],
  ['Mood changes', ['mood swings', 'mood change', 'irritable', 'anxious', 'sad']],
  ['Sleep changes', ['sleep changes', 'insomnia', 'poor sleep', 'slept']],
  ['Bloating', ['bloating', 'bloated', 'bloat']],
  ['Nausea', ['nausea', 'nauseous']],
  ['Spotting', ['spotting']],
  ['Heavy bleeding', ['heavy bleeding', 'heavy flow']],
  ['Back pain', ['backache', 'back pain']],
  ['Breast tenderness', ['breast tenderness', 'tender breasts']],
  ['Dizziness', ['dizzy', 'dizziness']],
  ['Acne', ['acne', 'breakout']]
];

const eventKinds = [
  ['period-start', 'Period started'],
  ['period-end', 'Period ended'],
  ['symptom', 'Symptom'],
  ['context', 'Life or treatment context'],
  ['note', 'General note']
];

const SYMPTOM_CHIPS = ['Lower energy', 'Pelvic discomfort', 'Cramps', 'Sleep changes', 'Mood changes', 'Headache'];
const selectedChips = new Set();

function renderChips() {
  document.getElementById('chipRow').innerHTML = SYMPTOM_CHIPS.map(chip => {
    const on = selectedChips.has(chip);
    return `<button type="button" class="chip${on ? ' selected' : ''}" aria-pressed="${on}" onclick="toggleChip('${chip}')">${escapeHTML(chip)}</button>`;
  }).join('');
}

function toggleChip(chip) {
  selectedChips.has(chip) ? selectedChips.delete(chip) : selectedChips.add(chip);
  renderChips();
}

// Known label -> slug (e.g. "Lower energy" -> "lower-energy"); anything else -> "other".
function categoryFor(label) {
  const known = SYMPTOM_CHIPS.find(c => c.toLowerCase() === label.trim().toLowerCase());
  return known ? known.toLowerCase().replace(/\s+/g, '-') : 'other';
}


function readJSON(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    if (Array.isArray(value)) {
      return value.map(item => ({ schemaVersion: CURRENT_SCHEMA_VERSION, ...item }));
    }
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function persistEntries() {
  localStorage.setItem(ENTRY_KEY, JSON.stringify(entries));
}

function persistVoiceNotes() {
  localStorage.setItem(VOICE_KEY, JSON.stringify(voiceNotes));
}

function localISODate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dayNumber(isoDate) {
  const [year, month, day] = isoDate.split('-').map(Number);
  return Date.UTC(year, month - 1, day) / 86_400_000;
}

function dateFromDayOffset(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return localISODate(date);
}

function formatDate(isoDate, options = { month: 'short', day: 'numeric', year: 'numeric' }) {
  if (!isoDate) return '';
  return new Date(`${isoDate}T12:00:00`).toLocaleDateString(undefined, options);
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function saveAndRender() {
  persistEntries();
  render();
}

function go(page) {
  document.querySelectorAll('.nav button').forEach(button => {
    button.classList.toggle('active', button.dataset.page === page);
  });
  document.querySelectorAll('.page').forEach(section => {
    section.classList.toggle('active', section.id === `page-${page}`);
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (page === 'summary') generateSummary();
  if (page === 'records') renderRecordNotes();
}

document.querySelectorAll('.nav button').forEach(button => {
  button.addEventListener('click', () => go(button.dataset.page));
});

document.getElementById('todayDate').textContent = new Date().toLocaleDateString(undefined, {
  weekday: 'short', month: 'long', day: 'numeric'
});

let currentTimelineFilter = 'all';

function getAllTimelineItems() {
  const visibleEntries = entries.filter(entry => entry.type !== 'voice-source');
  const docItems = documents.filter(doc => doc.recordDate && doc.showOnTimeline !== false).map(doc => ({
    id: 'doc-' + doc.id,
    type: 'document',
    date: doc.recordDate,
    title: doc.name,
    category: doc.category || 'Lab / Medical report',
    detail: doc.keyFinding ? `Key finding: ${doc.keyFinding}${doc.notes ? ` · Note: ${doc.notes}` : ''}` : (doc.notes || ''),
    documentId: doc.id,
    fileName: doc.name
  }));
  return [...visibleEntries, ...docItems].sort((a, b) => b.date.localeCompare(a.date));
}

function timelineMarkup(list) {
  if (!list.length) {
    return '<p class="empty-state">Nothing to display for this filter.</p>';
  }

  const byDate = new Map();
  list.slice().sort((a, b) => b.date.localeCompare(a.date)).forEach(entry => {
    if (!byDate.has(entry.date)) byDate.set(entry.date, []);
    byDate.get(entry.date).push(entry);
  });

  return Array.from(byDate.entries()).map(([dateStr, items]) => {
    const hasMarker = items.some(e => e.type === 'context');
    const hasPeriod = items.some(e => e.type === 'period');
    const hasDoc = items.some(e => e.type === 'document');

    const eventDotClass = hasDoc ? 'lab-report' : hasMarker ? 'marker' : '';
    const formattedDate = formatDate(dateStr, { month: 'short', day: 'numeric' });
    const year = new Date(`${dateStr}T12:00:00`).getFullYear();

    const itemsHTML = items.map(entry => {
      if (entry.type === 'document') {
        return `<div class="timeline-day-entry lab-entry">
          <div class="timeline-day-entry-main">
            <strong>${escapeHTML(entry.title)}</strong>
            ${entry.detail ? `<span class="timeline-entry-note">${escapeHTML(entry.detail)}</span>` : ''}
          </div>
          <div class="timeline-day-entry-tags">
            <span class="tag lab-tag">${escapeHTML(entry.category || 'Lab / Report')}</span>
            <button class="text-button timeline-source" onclick="downloadDocumentById('${entry.documentId}')">Download</button>
            <button class="text-button timeline-source" onclick="go('records')">View in records</button>
          </div>
        </div>`;
      }

      if (entry.type === 'period') {
        const detailText = entry.detail && entry.detail !== 'Cycle event' && entry.detail !== 'Added from your reviewed voice check-in'
          ? `<span class="timeline-entry-note">${escapeHTML(entry.detail)}</span>`
          : '';
        return `<div class="timeline-day-entry period-entry">
          <div class="timeline-day-entry-main">
            <strong>${escapeHTML(entry.title)}</strong>
            ${detailText}
          </div>
          <div class="timeline-day-entry-tags">
            <span class="tag plum">Cycle event</span>
          </div>
        </div>`;
      }

      if (entry.type === 'context') {
        return `<div class="timeline-day-entry context-entry">
          <div class="timeline-day-entry-main">
            <strong>${escapeHTML(entry.title)}</strong>
            ${entry.detail ? `<span class="timeline-entry-note">${escapeHTML(entry.detail)}</span>` : ''}
          </div>
          <div class="timeline-day-entry-tags">
            <span class="tag green">Context marker</span>
          </div>
        </div>`;
      }

      // Check-in or personal note
      const sourceTag = entry.sourceId ? `<button class="text-button timeline-source" onclick="go('records')">View voice note</button>` : '';
      const detailText = entry.detail && entry.detail !== 'Added by you' && entry.detail !== 'Added from your reviewed voice check-in' && entry.detail !== 'Check-in'
        ? `<span class="timeline-entry-note">${escapeHTML(entry.detail)}</span>`
        : '';

      return `<div class="timeline-day-entry checkin-entry">
        <div class="timeline-day-entry-main">
          <strong>${escapeHTML(entry.title)}</strong>
          ${detailText}
        </div>
        <div class="timeline-day-entry-tags">
          <span class="tag ${entry.type === 'record' ? 'green' : ''}">Check-in</span>
          ${sourceTag}
        </div>
      </div>`;
    }).join('');

    return `<div class="event ${eventDotClass}">
      <div class="event-date">${formattedDate} · ${year}</div>
      <div class="event-text">
        <div class="timeline-day-group">
          ${itemsHTML}
        </div>
      </div>
    </div>`;
  }).join('');
}

function filterTimeline(filter) {
  currentTimelineFilter = filter;
  document.querySelectorAll('.timeline-filter-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filter === filter);
  });
  renderTimelineOnly();
}

function renderTimelineOnly() {
  const allItems = getAllTimelineItems();
  let filtered = allItems;
  if (currentTimelineFilter === 'period') {
    filtered = allItems.filter(item => item.type === 'period');
  } else if (currentTimelineFilter === 'symptom') {
    filtered = allItems.filter(item => item.type === 'symptom');
  } else if (currentTimelineFilter === 'context') {
    filtered = allItems.filter(item => item.type === 'context');
  } else if (currentTimelineFilter === 'document') {
    filtered = allItems.filter(item => item.type === 'document');
  }
  const fullEl = document.getElementById('fullTimeline');
  if (fullEl) {
    fullEl.innerHTML = timelineMarkup(filtered);
  }
  const totalEl = document.getElementById('eventTotal');
  if (totalEl) {
    totalEl.textContent = `${filtered.length} ${filtered.length === 1 ? 'entry' : 'entries'}`;
  }
}

function periodStarts() {
  return entries.filter(entry => entry.type === 'period' && (entry.periodRole === 'start' || entry.title === 'Period started'))
    .slice().sort((a, b) => a.date.localeCompare(b.date));
}

function cycleIntervals() {
  const starts = periodStarts();
  return starts.slice(1).map((entry, index) => ({
    days: dayNumber(entry.date) - dayNumber(starts[index].date),
    start: starts[index],
    end: entry
  })).filter(interval => interval.days >= 15 && interval.days < 200);
}

function bleedingDurations() {
  const starts = periodStarts();
  const ends = entries.filter(entry => entry.type === 'period' && (entry.periodRole === 'end' || entry.title === 'Period ended'))
    .slice().sort((a, b) => a.date.localeCompare(b.date));
  return starts.flatMap((start, index) => {
    const nextStart = starts[index + 1]?.date;
    const end = ends.find(item => item.date >= start.date && (!nextStart || item.date < nextStart));
    if (!end) return [];
    const days = dayNumber(end.date) - dayNumber(start.date) + 1;
    return days > 0 && days <= 30 ? [{ days, start, end }] : [];
  });
}

function renderStats() {
  const analysis = analyze(entries, { today: localISODate(), rules: RULES });
  const starts = periodStarts();
  const recentIntervals = cycleIntervals().slice(-4);
  const range = analysis.summary
    ? `${analysis.summary.min}–${analysis.summary.max} d`
    : (recentIntervals.length
      ? `${Math.min(...recentIntervals.map(item => item.days))}–${Math.max(...recentIntervals.map(item => item.days))} d`
      : '—');

  document.getElementById('cycleLengthRange').textContent = range;
  const confText = analysis.confidence.charAt(0).toUpperCase() + analysis.confidence.slice(1);
  document.getElementById('cycleRangeCaption').textContent = `${confText} confidence · ${analysis.basedOnCycles} cycle${analysis.basedOnCycles === 1 ? '' : 's'}`;
  document.getElementById('periodCount').textContent = starts.length;

  const durations = bleedingDurations().slice(-4);
  const durationRange = durations.length
    ? `${Math.min(...durations.map(item => item.days))}–${Math.max(...durations.map(item => item.days))} d`
    : '—';
  document.getElementById('bleedingDuration').textContent = durationRange;
  document.getElementById('bleedingCaption').textContent = durations.length
    ? `${durations.length} date pair${durations.length === 1 ? '' : 's'}`
    : 'Need a start + end';

  const thirtyDaysAgo = dayNumber(localISODate()) - 29;
  const recentCheckins = entries.filter(entry => ['symptom', 'context', 'record'].includes(entry.type)
    && dayNumber(entry.date) >= thirtyDaysAgo).length;
  document.getElementById('checkinCount').textContent = recentCheckins;

  const rangeElement = document.getElementById('latestCycleRange');
  const captionElement = document.getElementById('rangeCaption');
  rangeElement.textContent = range;
  captionElement.textContent = recentIntervals.length
    ? 'Calculated from the period start dates you logged.'
    : 'Cycle lengths appear after two period starts.';

  const band = document.querySelector('.range-band');
  const marker = document.querySelector('.range-dot');
  if (recentIntervals.length) {
    const min = Math.min(...recentIntervals.map(item => item.days));
    const max = Math.max(...recentIntervals.map(item => item.days));
    const scale = value => Math.max(0, Math.min(100, ((value - 20) / 100) * 100));
    band.style.left = `${scale(min)}%`;
    band.style.width = `${Math.max(2, scale(max) - scale(min))}%`;
    marker.style.left = `${scale(recentIntervals.reduce((sum, item) => sum + item.days, 0) / recentIntervals.length)}%`;
  } else {
    band.style.left = '0%';
    band.style.width = '0%';
    marker.style.left = '50%';
  }
}

function renderCycleReadiness() {
  const card = document.getElementById('readinessCard');
  if (!card) return;

  const starts = periodStarts();
  if (!starts.length) {
    document.getElementById('readinessDates').textContent = '—';
    document.getElementById('readinessCycleDay').textContent = 'Day —';
    document.getElementById('readinessBadge').textContent = 'Needs 1 period start';
    document.getElementById('readinessBadge').className = 'readiness-badge building';
    document.getElementById('readinessSource').textContent = 'Log your last period start to calculate your next window';
    document.getElementById('readinessTipTitle').textContent = 'Awaiting your first period start';
    document.getElementById('readinessTipBody').textContent = 'Once you record a period start date, Cycle Context will map your personal window of possibility.';
    document.getElementById('readinessBand').style.left = '0%';
    document.getElementById('readinessBand').style.width = '0%';
    document.getElementById('readinessMarker').style.left = '0%';
    return;
  }

  const todayStr = localISODate();
  const todayNum = dayNumber(todayStr);
  const lastStart = starts[starts.length - 1];
  const lastStartNum = dayNumber(lastStart.date);
  const cycleDay = Math.max(1, todayNum - lastStartNum + 1);

  // Check if currently bleeding
  const ends = entries.filter(e => e.type === 'period' && (e.periodRole === 'end' || e.title === 'Period ended'))
    .sort((a, b) => a.date.localeCompare(b.date));
  const recentEnd = ends.filter(e => e.date >= lastStart.date)[0];
  const isBleeding = (!recentEnd && cycleDay <= 7) || (recentEnd && todayNum <= dayNumber(recentEnd.date));

  // Cycle interval history
  const intervals = cycleIntervals();
  let minDays, maxDays, avgDays, sourceText;

  if (intervals.length >= 2) {
    const dayVals = intervals.slice(-6).map(i => i.days);
    minDays = Math.max(21, Math.min(...dayVals));
    maxDays = Math.max(minDays + 2, Math.max(...dayVals));
    avgDays = Math.round(dayVals.reduce((a, b) => a + b, 0) / dayVals.length);
    sourceText = `Based on your last ${dayVals.length} logged cycles (${minDays}–${maxDays} d range)`;
  } else if (intervals.length === 1) {
    const single = Math.max(21, intervals[0].days);
    minDays = Math.max(21, single - 4);
    maxDays = single + 4;
    avgDays = single;
    sourceText = `Based on previous interval (${single} d) with ±4 days variation buffer`;
  } else {
    // Standard FIGO normal variation benchmark (24-38 days)
    minDays = 24;
    maxDays = 38;
    avgDays = 28;
    sourceText = 'Based on FIGO reference window (24–38 d) until more cycles are logged';
  }

  // Calculate earliest and latest expected dates using UTC millisecond arithmetic
  const earliestDate = new Date((lastStartNum + minDays - 1) * 86_400_000);
  const latestDate = new Date((lastStartNum + maxDays - 1) * 86_400_000);
  const earliestDateStr = localISODate(earliestDate);
  const latestDateStr = localISODate(latestDate);

  const formattedWindow = `${formatDate(earliestDateStr, { month: 'short', day: 'numeric' })} – ${formatDate(latestDateStr, { month: 'short', day: 'numeric' })}`;
  document.getElementById('readinessDates').textContent = formattedWindow;
  document.getElementById('readinessCycleDay').textContent = `Day ${cycleDay}`;
  document.getElementById('readinessSource').textContent = sourceText;

  // Status classification & readiness guidance
  let badgeClass, badgeText, tipTitle, tipIcon, tipBody;
  const daysUntilWindow = minDays - cycleDay;

  if (isBleeding) {
    badgeClass = 'bleeding';
    badgeText = `Active Menstrual Phase (Day ${cycleDay})`;
    tipIcon = '🩸';
    tipTitle = 'Menstrual phase in progress';
    tipBody = 'You are currently in your bleeding phase. Take rest, stay hydrated, and log any pelvic sensations or flow notes.';
  } else if (cycleDay < minDays - 3) {
    badgeClass = 'building';
    badgeText = `Cycle Building · ~${daysUntilWindow}d to window`;
    tipIcon = '🌱';
    tipTitle = `Window begins in ~${daysUntilWindow} days`;
    tipBody = `Expected window opens ${formatDate(earliestDateStr, { month: 'short', day: 'numeric' })} (Day ${minDays}). Typical follicular or mid-cycle phase; no extra preparation needed yet.`;
  } else if (cycleDay >= minDays - 3 && cycleDay < minDays) {
    badgeClass = 'approaching';
    badgeText = `Approaching window (~${daysUntilWindow}d)`;
    tipIcon = '👜';
    tipTitle = 'Preparedness mode';
    tipBody = `Your cycle is nearing your typical start window (${formatDate(earliestDateStr, { month: 'short', day: 'numeric' })}). Keep supplies with you and watch for early physical signs.`;
  } else if (cycleDay >= minDays && cycleDay <= maxDays) {
    badgeClass = 'inside';
    badgeText = `Inside window (Day ${cycleDay} of ${minDays}–${maxDays}d)`;
    tipIcon = '✨';
    tipTitle = 'Inside typical start window';
    tipBody = `You are in your normal start zone (${minDays}–${maxDays} days). Bleeding may begin any day; tap "Log period" when it starts.`;
  } else {
    badgeClass = 'extended';
    badgeText = `Beyond typical range (Day ${cycleDay})`;
    tipIcon = '⏱';
    tipTitle = `Day ${cycleDay} (past your typical ${maxDays}d max)`;
    tipBody = cycleDay >= 90
      ? 'It has been 90+ days since your last period. FIGO criteria define this as an extended gap worth reviewing with a clinician.'
      : `Past your recent ${maxDays}-day upper range. Natural shifts in sleep, stress, or hormones commonly extend intervals. Note how you are feeling in check-ins.`;
  }

  const badgeEl = document.getElementById('readinessBadge');
  badgeEl.className = `readiness-badge ${badgeClass}`;
  badgeEl.textContent = badgeText;

  document.getElementById('readinessIcon').textContent = tipIcon;
  document.getElementById('readinessTipTitle').textContent = tipTitle;
  document.getElementById('readinessTipBody').textContent = tipBody;

  // Track Visualizer: scale from 1 to max(cycleDay + 10, maxDays + 15, 50)
  const maxScale = Math.max(cycleDay + 10, maxDays + 15, 50);
  const scalePercent = val => Math.max(0, Math.min(100, (val / maxScale) * 100));

  const bandLeft = scalePercent(minDays);
  const bandRight = scalePercent(maxDays);
  const bandWidth = Math.max(2, bandRight - bandLeft);
  const markerLeft = scalePercent(cycleDay);

  document.getElementById('readinessBand').style.left = `${bandLeft}%`;
  document.getElementById('readinessBand').style.width = `${bandWidth}%`;
  document.getElementById('readinessMarker').style.left = `${markerLeft}%`;

  document.getElementById('readinessScaleStart').textContent = `Day 1 (${formatDate(lastStart.date, { month: 'short', day: 'numeric' })})`;
  document.getElementById('readinessScaleWindow').textContent = `Window: Day ${minDays}–${maxDays}`;
  document.getElementById('readinessScaleEnd').textContent = `Day ${maxScale}`;
}

function renderCycleChart() {
  const intervals = cycleIntervals().slice(-6);
  const chart = document.getElementById('cycleChart');
  const axis = document.getElementById('cycleChartAxis');
  if (!intervals.length) {
    chart.innerHTML = '<p class="empty-state">Log at least two period start dates to see the time between them.</p>';
    axis.textContent = '';
    return;
  }

  const xAt = index => intervals.length === 1 ? 300 : 42 + (index * 516) / (intervals.length - 1);
  const dayValues = intervals.map(item => item.days);
  const minDays = Math.floor(Math.min(20, ...dayValues) / 10) * 10;
  const maxDays = Math.ceil(Math.max(60, ...dayValues) / 10) * 10;
  const yAt = days => 170 - ((days - minDays) / Math.max(1, maxDays - minDays)) * 136;
  const grid = Array.from({ length: 5 }, (_, index) => {
    const y = 34 + index * 34;
    const label = Math.round(maxDays - ((maxDays - minDays) * index) / 4);
    return `<path d="M0 ${y}H600"/><text x="0" y="${y - 3}" fill="#75807a" stroke="none" font-size="9">${label}</text>`;
  }).join('');
  const points = intervals.map((item, index) => `${xAt(index)},${yAt(item.days)}`).join(' ');
  const markers = entries.filter(entry => entry.type === 'context');
  const start = dayNumber(intervals[0].start.date);
  const end = dayNumber(intervals[intervals.length - 1].end.date);
  const contextLines = markers.filter(item => dayNumber(item.date) >= start && dayNumber(item.date) <= end)
    .map(item => {
      const x = 42 + ((dayNumber(item.date) - start) / Math.max(1, end - start)) * 516;
      return `<line x1="${x}" y1="18" x2="${x}" y2="174" stroke="#c18b16" stroke-width="1.5" stroke-dasharray="4 4"/>`;
    }).join('');
  const circles = intervals.map((item, index) => `<circle cx="${xAt(index)}" cy="${yAt(item.days)}" r="5" fill="#075f59" stroke="#fffefa" stroke-width="3"><title>${item.days} days, ending ${formatDate(item.end.date)}</title></circle>`).join('');
  chart.innerHTML = `<svg viewBox="0 0 600 190" preserveAspectRatio="none" role="img" aria-label="Recorded cycle lengths over time">
    <g stroke="#e4e8e1" stroke-width="1" fill="#75807a">${grid}</g>
    ${contextLines}<polyline points="${points}" fill="none" stroke="#075f59" stroke-width="2.5"/>${circles}
  </svg>`;
  axis.innerHTML = intervals.map(item => `<span>${formatDate(item.end.date, { month: 'short' })}</span>`).join('');
}

function rangeText(intervals) {
  if (!intervals.length) return 'Not enough recorded cycle intervals yet.';
  const lengths = intervals.map(item => item.days);
  return `${Math.min(...lengths)}–${Math.max(...lengths)} days across ${lengths.length} recorded interval${lengths.length === 1 ? '' : 's'}`;
}

let selectedMarkerId = null;

function selectChangeMarker(id) {
  selectedMarkerId = id;
  renderChangeComparison();
}

function renderChangeComparison() {
  const markers = entries.filter(entry => entry.type === 'context').sort((a, b) => b.date.localeCompare(a.date));
  const label = document.getElementById('changeMarkerLabel');
  const target = document.getElementById('changeCompare');
  const selectWrapper = document.getElementById('changeSelectWrapper');

  if (!markers.length) {
    if (label) label.textContent = 'Personal markers';
    if (selectWrapper) selectWrapper.innerHTML = '';
    target.innerHTML = `<div class="empty-state" style="padding:24px 0">
      <p style="margin-bottom:12px">No context milestones recorded yet. When you add a medication change, lifestyle shift, or health event, you can explore how your cycle and symptoms shifted before vs after.</p>
      <button class="btn primary" onclick="openLog('context')">＋ Mark a milestone</button>
    </div>`;
    return;
  }

  if (!selectedMarkerId || !markers.some(m => (m.id || `${m.date}-${m.title}`) === selectedMarkerId)) {
    selectedMarkerId = markers[0].id || `${markers[0].date}-${markers[0].title}`;
  }

  if (selectWrapper) {
    selectWrapper.innerHTML = `<select onchange="selectChangeMarker(this.value)" aria-label="Select milestone to compare">
      ${markers.map(m => {
        const id = m.id || `${m.date}-${m.title}`;
        const isSel = id === selectedMarkerId;
        return `<option value="${escapeHTML(id)}"${isSel ? ' selected' : ''}>${escapeHTML(m.title)} (${formatDate(m.date, { month: 'short', day: 'numeric', year: 'numeric' })})</option>`;
      }).join('')}
    </select>`;
  }

  const marker = markers.find(m => (m.id || `${m.date}-${m.title}`) === selectedMarkerId) || markers[0];
  if (label) label.textContent = `${marker.title} · ${formatDate(marker.date, { month: 'short', day: 'numeric' })}`;

  const intervals = cycleIntervals();
  const beforeIntervals = intervals.filter(item => item.end.date <= marker.date);
  const afterIntervals = intervals.filter(item => item.end.date > marker.date);

  const calcIntervalStats = (list) => {
    if (!list.length) return null;
    const days = list.map(i => i.days);
    const min = Math.min(...days);
    const max = Math.max(...days);
    const mean = Math.round(days.reduce((a, b) => a + b, 0) / days.length);
    const spread = max - min;
    const rangeStr = min === max ? `${min} days` : `${min}–${max} days`;
    return { count: list.length, min, max, mean, spread, rangeStr };
  };

  const beforeCycle = calcIntervalStats(beforeIntervals);
  const afterCycle = calcIntervalStats(afterIntervals);

  let cycleDeltaSummary = 'Record at least 1 cycle interval on each side to view change metrics';
  let cycleDeltaClass = 'neutral';
  if (beforeCycle && afterCycle) {
    const diff = afterCycle.mean - beforeCycle.mean;
    const spreadDiff = afterCycle.spread - beforeCycle.spread;
    const diffText = diff === 0 ? 'Same average length' : `${diff > 0 ? `+${diff}` : diff} days average length`;
    const spreadText = spreadDiff === 0 ? 'unchanged spread' : `spread ${spreadDiff < 0 ? `reduced by ${Math.abs(spreadDiff)}d` : `widened by ${spreadDiff}d`}`;
    cycleDeltaSummary = `${diffText} · Variation ${spreadText}`;
    cycleDeltaClass = spreadDiff <= 0 ? 'positive' : 'neutral';
  }

  const durations = bleedingDurations();
  const beforeDurations = durations.filter(d => d.end.date <= marker.date);
  const afterDurations = durations.filter(d => d.end.date > marker.date);

  const calcBleedStats = (list) => {
    if (!list.length) return null;
    const days = list.map(d => d.days);
    const min = Math.min(...days);
    const max = Math.max(...days);
    const mean = (days.reduce((a, b) => a + b, 0) / days.length).toFixed(1);
    const rangeStr = min === max ? `${min} days` : `${min}–${max} days`;
    return { count: list.length, min, max, mean, rangeStr };
  };

  const beforeBleed = calcBleedStats(beforeDurations);
  const afterBleed = calcBleedStats(afterDurations);

  let bleedDeltaSummary = 'Add start + end dates to compare bleeding duration';
  let bleedDeltaClass = 'neutral';
  if (beforeBleed && afterBleed) {
    const diff = (parseFloat(afterBleed.mean) - parseFloat(beforeBleed.mean)).toFixed(1);
    const diffText = diff === '0.0' ? 'Unchanged bleeding duration' : `${diff > 0 ? `+${diff}` : diff} days average bleeding`;
    bleedDeltaSummary = diffText;
    bleedDeltaClass = parseFloat(diff) <= 0 ? 'positive' : 'neutral';
  }

  const symptomEntries = entries.filter(e => e.type === 'symptom');
  const symptomsMap = new Map();
  symptomEntries.forEach(entry => {
    const name = entry.title.trim();
    if (!name) return;
    const key = name.toLowerCase();
    const curr = symptomsMap.get(key) || { name, before: 0, after: 0 };
    if (entry.date <= marker.date) curr.before += 1;
    else curr.after += 1;
    symptomsMap.set(key, curr);
  });

  const symptomRows = [...symptomsMap.values()]
    .sort((a, b) => (b.before + b.after) - (a.before + a.after));

  const symptomsHTML = symptomRows.length ? `
    <div class="symptom-shift-grid">
      ${symptomRows.map(s => `
        <div class="symptom-shift-badge">
          <span>${escapeHTML(s.name)}</span>
          <div class="symptom-shift-counts">
            <span class="shift-before">${s.before}× before</span>
            <span class="shift-arrow">→</span>
            <span class="shift-after">${s.after}× after</span>
          </div>
        </div>
      `).join('')}
    </div>
  ` : '<p class="empty-state" style="margin:8px 0 0">No symptoms recorded in check-ins around this period.</p>';

  target.innerHTML = `
    <div class="marker-pill-banner">
      <div class="marker-pill-info">
        <span class="tag amber">Milestone</span>
        <strong>${escapeHTML(marker.title)}</strong>
        <span class="marker-date">${formatDate(marker.date, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
      </div>
      <div class="marker-detail-note">${escapeHTML(marker.detail || 'Context recorded by you')}</div>
    </div>

    <div class="explorer-metrics-grid">
      <div class="explorer-stat-card">
        <div>
          <div class="stat-header">
            <span class="stat-icon">⌁</span>
            <strong>Cycle Length &amp; Variation</strong>
          </div>
          <div class="stat-split">
            <div class="split-col before">
              <span class="col-tag">Before (${beforeCycle ? `${beforeCycle.count} cycle${beforeCycle.count === 1 ? '' : 's'}` : '0 cycles'})</span>
              <div class="col-value">${beforeCycle ? beforeCycle.rangeStr : '—'}</div>
              <small class="col-sub">${beforeCycle ? `Avg: ${beforeCycle.mean}d · Spread: ±${beforeCycle.spread}d` : 'No intervals recorded'}</small>
            </div>
            <div class="split-col after">
              <span class="col-tag">After (${afterCycle ? `${afterCycle.count} cycle${afterCycle.count === 1 ? '' : 's'}` : '0 cycles'})</span>
              <div class="col-value">${afterCycle ? afterCycle.rangeStr : '—'}</div>
              <small class="col-sub">${afterCycle ? `Avg: ${afterCycle.mean}d · Spread: ±${afterCycle.spread}d` : 'No intervals recorded'}</small>
            </div>
          </div>
        </div>
        <div class="stat-delta ${cycleDeltaClass}">
          <span>✦</span> ${cycleDeltaSummary}
        </div>
      </div>

      <div class="explorer-stat-card">
        <div>
          <div class="stat-header">
            <span class="stat-icon">◈</span>
            <strong>Bleeding Duration</strong>
          </div>
          <div class="stat-split">
            <div class="split-col before">
              <span class="col-tag">Before (${beforeBleed ? `${beforeBleed.count} period${beforeBleed.count === 1 ? '' : 's'}` : '0 periods'})</span>
              <div class="col-value">${beforeBleed ? beforeBleed.rangeStr : '—'}</div>
              <small class="col-sub">${beforeBleed ? `Avg: ${beforeBleed.mean} days` : 'No start/end pairs'}</small>
            </div>
            <div class="split-col after">
              <span class="col-tag">After (${afterBleed ? `${afterBleed.count} period${afterBleed.count === 1 ? '' : 's'}` : '0 periods'})</span>
              <div class="col-value">${afterBleed ? afterBleed.rangeStr : '—'}</div>
              <small class="col-sub">${afterBleed ? `Avg: ${afterBleed.mean} days` : 'No start/end pairs'}</small>
            </div>
          </div>
        </div>
        <div class="stat-delta ${bleedDeltaClass}">
          <span>✦</span> ${bleedDeltaSummary}
        </div>
      </div>
    </div>

    <div class="explorer-symptoms-section">
      <div class="stat-header" style="margin-bottom:0">
        <span class="stat-icon">✦</span>
        <strong>Symptoms Reported Around This Change</strong>
      </div>
      ${symptomsHTML}
    </div>

    <div class="callout explorer-callout">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px;margin-right:6px"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4m0-4h.01"/></svg>
      <strong>Observation note:</strong> This comparison reflects observed timing in your personal journal. It describes how your entries varied before and after this milestone date; it does not infer medical cause or effect.
    </div>
  `;
}

let currentSymptomView = 'timing';

function switchSymptomView(mode) {
  currentSymptomView = mode;
  const tabTiming = document.getElementById('symTabTiming');
  const tabCounts = document.getElementById('symTabCounts');
  if (tabTiming && tabCounts) {
    tabTiming.classList.toggle('active', mode === 'timing');
    tabCounts.classList.toggle('active', mode === 'counts');
  }
  renderSymptomPatterns();
}

function getSymptomTiming(entry, starts, averageCycleLength = 30) {
  const eDay = dayNumber(entry.date);
  const prevStart = [...starts].reverse().find(s => dayNumber(s.date) <= eDay);
  const nextStart = starts.find(s => dayNumber(s.date) > eDay);

  let cycleDay = null;
  let daysBeforeNext = null;
  let phaseName = 'Unlinked (no cycle starts)';
  let phaseSlug = 'unlinked';
  let percentage = 50;

  if (prevStart) {
    cycleDay = eDay - dayNumber(prevStart.date) + 1;
    const estimatedLen = nextStart ? (dayNumber(nextStart.date) - dayNumber(prevStart.date)) : averageCycleLength;
    percentage = Math.min(100, Math.max(0, Math.round((cycleDay / Math.max(1, estimatedLen)) * 100)));
  }

  if (nextStart) {
    daysBeforeNext = dayNumber(nextStart.date) - eDay;
  }

  if (daysBeforeNext !== null && daysBeforeNext <= 7 && daysBeforeNext >= 1) {
    phaseName = daysBeforeNext <= 3 ? 'Pre-menstrual (1–3d before)' : 'Late luteal (4–7d before)';
    phaseSlug = 'pre-menstrual';
  } else if (cycleDay !== null) {
    if (cycleDay <= 5) {
      phaseName = 'Menstrual phase (Days 1–5)';
      phaseSlug = 'menstrual';
    } else if (cycleDay >= 12 && cycleDay <= 17) {
      phaseName = 'Mid-cycle / Ovulatory (Days 12–17)';
      phaseSlug = 'mid-cycle';
    } else if (cycleDay < 12) {
      phaseName = 'Follicular phase (Days 6–11)';
      phaseSlug = 'follicular';
    } else {
      phaseName = `Luteal phase (Cycle Day ${cycleDay})`;
      phaseSlug = 'luteal';
    }
  }

  return { cycleDay, daysBeforeNext, phaseName, phaseSlug, percentage, prevStart, nextStart };
}

function renderSymptomPatterns() {
  const target = document.getElementById('symptomPatterns');
  if (!target) return;

  const symptomEntries = entries.filter(entry => entry.type === 'symptom');
  if (!symptomEntries.length) {
    target.innerHTML = '<p class="empty-state">Symptoms mentioned in check-ins will appear here with cycle phase analysis.</p>';
    return;
  }

  const starts = periodStarts();
  const intervals = cycleIntervals();
  const averageCycle = intervals.length
    ? Math.round(intervals.reduce((a, b) => a + b.days, 0) / intervals.length)
    : 30;

  const grouped = new Map();
  symptomEntries.forEach(entry => {
    const name = entry.title.trim();
    if (!name) return;
    const key = name.toLowerCase();
    const timing = getSymptomTiming(entry, starts, averageCycle);
    const item = grouped.get(key) || { name, count: 0, timings: [], entries: [] };
    item.count += 1;
    item.timings.push(timing);
    item.entries.push(entry);
    grouped.set(key, item);
  });

  const items = [...grouped.values()].sort((a, b) => b.count - a.count);

  if (currentSymptomView === 'counts') {
    target.innerHTML = items.map(({ name, count }) => `
      <div class="report-row">
        <div>
          <strong>${escapeHTML(name)}</strong>
          <small>Logged ${count} time${count === 1 ? '' : 's'}</small>
        </div>
        <span class="tag plum">${count}</span>
      </div>
    `).join('');
    return;
  }

  target.innerHTML = `
    <div class="symptom-timing-list">
      ${items.map(({ name, count, timings, entries: itemEntries }) => {
        const phaseCounts = new Map();
        timings.forEach(t => phaseCounts.set(t.phaseSlug, (phaseCounts.get(t.phaseSlug) || 0) + 1));
        const [topPhaseSlug, topPhaseCount] = [...phaseCounts.entries()].sort((a, b) => b[1] - a[1])[0] || ['unlinked', 0];
        const dominantTiming = timings.find(t => t.phaseSlug === topPhaseSlug) || timings[0];
        const percentInPhase = Math.round((topPhaseCount / count) * 100);

        const markersHTML = timings.map(t =>
          `<div class="cycle-track-marker" style="left:${t.percentage}%" title="${escapeHTML(name)}: Day ${t.cycleDay || '?'} (${t.phaseName})"></div>`
        ).join('');

        const entriesBullets = itemEntries.map((e, idx) => {
          const t = timings[idx];
          const cycleLabel = t.cycleDay ? `Cycle Day ${t.cycleDay}` : 'Unlinked';
          const preLabel = t.daysBeforeNext !== null ? `(${t.daysBeforeNext}d before next period)` : '';
          return `<div class="symptom-entry-bullet">
            <span><strong>${formatDate(e.date)}</strong>: ${cycleLabel} ${preLabel}</span>
            <span style="font-style:italic">${escapeHTML(e.detail && e.detail !== 'Added by you' ? e.detail : '')}</span>
          </div>`;
        }).join('');

        return `
          <div class="symptom-timing-item">
            <div class="symptom-timing-top">
              <div class="symptom-timing-name">
                ${escapeHTML(name)}
                <span class="tag plum" style="font-size:11px">${count}×</span>
              </div>
              <div class="symptom-timing-meta">
                <span class="phase-pill ${topPhaseSlug}">${dominantTiming.phaseName.split('(')[0].trim()}</span>
              </div>
            </div>

            <div class="symptom-phase-summary">
              <strong>${percentInPhase}% of instances</strong> recorded in <em>${dominantTiming.phaseName}</em>.
            </div>

            <div class="symptom-cycle-track">
              ${markersHTML}
            </div>
            <div class="cycle-track-labels">
              <span>Day 1 (Period Start)</span>
              <span>Mid-cycle (~Day 14)</span>
              <span>Pre-menstrual (~Day ${averageCycle})</span>
            </div>

            <div class="symptom-entries-dropdown">
              ${entriesBullets}
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function renderInsight() {
  const analysis = analyze(entries, { today: localISODate(), rules: RULES });
  const target = document.getElementById('summaryInsight');
  if (analysis.flags.length) {
    const flag = analysis.flags[0];
    target.innerHTML = `<div class="insight-tag">Pattern to discuss</div>
      <p style="font-weight:600;margin:6px 0 4px;color:var(--ink)">${escapeHTML(flag.title)}</p>
      <p style="font-size:12px;line-height:1.55;color:#414a42;margin:0 0 8px">${escapeHTML(flag.message)}</p>
      <div class="source-line" style="font-size:10px;color:var(--muted)">Reference: ${escapeHTML(flag.rule?.source || 'FIGO 2018 criteria')} · These reference ranges haven't been clinically reviewed yet.</div>`;
    return;
  }

  const grouped = new Map();
  entries.filter(entry => entry.type === 'symptom').forEach(entry => grouped.set(entry.title, (grouped.get(entry.title) || 0) + 1));
  const top = [...grouped.entries()].sort((a, b) => b[1] - a[1])[0];
  target.innerHTML = top
    ? `<div class="insight-tag">From your entries</div><p>You’ve logged <b>${escapeHTML(top[0].toLowerCase())}</b> ${top[1]} time${top[1] === 1 ? '' : 's'}.</p><div class="source-line">A count of your own check-ins; no cause is inferred.</div>`
    : '<div class="insight-tag">From your entries</div><p>Add a voice check-in or cycle detail to start building your personal history.</p>';
}

function renderRecordNotes() {
  const target = document.getElementById('recordNotes');
  const manualNotes = entries.filter(entry => entry.type === 'record').sort((a, b) => b.date.localeCompare(a.date));
  const notes = [
    ...manualNotes.map(entry => ({ date: entry.date, title: entry.title, detail: entry.detail, kind: 'note' })),
    ...voiceNotes.map(note => ({ date: note.date, title: 'Voice check-in', detail: note.text, kind: 'voice' }))
  ].sort((a, b) => b.date.localeCompare(a.date));

  target.innerHTML = notes.length ? notes.map(note => `<article class="record-note ${note.kind === 'voice' ? 'voice-record' : ''}">
    <div class="record-note-top"><strong>${escapeHTML(note.title)}</strong><span class="tag ${note.kind === 'voice' ? 'plum' : 'green'}">${note.kind === 'voice' ? 'Original transcript' : 'Added by you'}</span></div>
    <small>${formatDate(note.date)}</small><p>${escapeHTML(note.detail || '')}</p></article>`).join('')
    : '<p class="empty-state">Your saved notes and reviewed voice check-ins will appear here.</p>';
}

function render() {
  const allItems = getAllTimelineItems();
  document.getElementById('recentTimeline').innerHTML = timelineMarkup(allItems.slice(0, 4));
  renderTimelineOnly();
  renderStats();
  renderCycleReadiness();
  renderCycleChart();
  renderChangeComparison();
  renderSymptomPatterns();
  renderInsight();
  renderRecordNotes();
  renderClinicianBrief();
  document.getElementById('recordSummaryCount').textContent = `${documents.length} file${documents.length === 1 ? '' : 's'} · ${entries.filter(entry => entry.type === 'record').length} note${entries.filter(entry => entry.type === 'record').length === 1 ? '' : 's'}`;
}

function openLog(type) {
  currentType = type;
  document.getElementById('entryDate').value = localISODate();
  document.getElementById('entryDetail').value = '';
  setType(type);
  document.getElementById('modalBackdrop').classList.add('show');
}

function setType(type) {
  currentType = type;
  document.querySelectorAll('.type-switch button').forEach(button => {
    button.classList.toggle('selected', button.dataset.type === type);
  });
  const labels = { period: 'Log a period', symptom: 'Add a check-in', context: 'Mark a change', record: 'Add a note' };
  const options = {
    period: ['Period started', 'Period ended'],
    context: ['Medication change', 'Routine change', 'Stressful period', 'Weight change', 'Clinician-recorded diagnosis', 'Other'],
    record: ['Clinician note', 'Test result note', 'Other note']
  };
  const isSymptom = type === 'symptom';
  document.getElementById('modalTitle').textContent = labels[type];
  document.getElementById('titleField').hidden = isSymptom;
  document.getElementById('chipField').hidden = !isSymptom;
  if (isSymptom) {
    selectedChips.clear();
    document.getElementById('entryLabel').value = '';
    renderChips();
  } else {
    document.getElementById('entryTitle').innerHTML =
      options[type].map(option => `<option>${escapeHTML(option)}</option>`).join('');
  }
}

function closeModal() {
  document.getElementById('modalBackdrop').classList.remove('show');
}

function saveEntry() {
  const date = document.getElementById('entryDate').value;
  if (!date) return toast('Choose a date first');
  if (currentType === 'symptom') {
    const labels = [...selectedChips];
    document.getElementById('entryLabel').value.split(',')
      .map(s => s.trim()).filter(Boolean)
      .forEach(t => { if (!labels.some(l => l.toLowerCase() === t.toLowerCase())) labels.push(t); });
    if (!labels.length) return toast('Pick a symptom or type what you felt');
    const detail = document.getElementById('entryDetail').value.trim() || 'Added by you';
    labels.forEach(label => entries.push({
      schemaVersion: CURRENT_SCHEMA_VERSION, id: newID(), date, type: 'symptom',
      title: label, category: categoryFor(label), detail
    }));
    saveAndRender();
    closeModal();
    return toast(labels.length === 1 ? 'Saved to your timeline' : `${labels.length} check-ins saved`);
  }
  entries.push({
    id: newID(), date, type: currentType,
    title: document.getElementById('entryTitle').value,
    detail: document.getElementById('entryDetail').value.trim() || 'Added by you',
    periodRole: currentType === 'period' ? (document.getElementById('entryTitle').value === 'Period ended' ? 'end' : 'start') : undefined
  });
  saveAndRender();
  closeModal();
  toast('Saved to your timeline');
}

function newID() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function toast(message) {
  const element = document.getElementById('toast');
  element.textContent = message;
  element.classList.add('show');
  setTimeout(() => element.classList.remove('show'), 2300);
}



function toggleRecording() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const status = document.getElementById('voiceStatus');
  if (isRecording) return recognition?.stop();
  if (!SpeechRecognition) {
    const isFile = window.location.protocol === 'file:';
    const isFirefox = navigator.userAgent.includes('Firefox');
    const isBrave = navigator.brave !== undefined;
    if (isFile) {
      status.textContent = 'Voice capture requires running through http://localhost:3000 (not opening the HTML file directly).';
    } else if (isFirefox) {
      status.textContent = 'Firefox does not support Web Speech recognition. Open http://localhost:3000 in Chrome, Edge, or Safari.';
    } else if (isBrave) {
      status.textContent = 'Brave disables Web Speech by default. Try Google Chrome or Safari at http://localhost:3000.';
    } else {
      status.textContent = 'Voice capture is not supported in this browser. Open http://localhost:3000 in Chrome, Edge, or Safari.';
    }
    document.getElementById('voiceText').focus();
    return;
  }

  recognition = new SpeechRecognition();
  recognition.lang = navigator.language || 'en-US';
  recognition.continuous = true;
  recognition.interimResults = true;
  let captured = '';
  recognition.onstart = () => {
    isRecording = true;
    const button = document.getElementById('recordBtn');
    button.classList.add('is-recording');
    button.setAttribute('aria-pressed', 'true');
    button.textContent = 'Stop recording';
    status.textContent = 'Listening. Stop when you have finished.';
  };
  recognition.onresult = event => {
    let interim = '';
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      if (event.results[index].isFinal) captured += `${event.results[index][0].transcript} `;
      else interim += event.results[index][0].transcript;
    }
    document.getElementById('voiceText').value = `${captured}${interim}`.trim();
  };
  recognition.onerror = event => {
    isRecording = false;
    resetRecordButton();
    status.textContent = event.error === 'not-allowed'
      ? 'Microphone permission was not granted. You can type your check-in instead.'
      : 'Voice capture stopped. You can edit or type your check-in.';
  };
  recognition.onend = () => {
    isRecording = false;
    resetRecordButton();
    const note = document.getElementById('voiceText').value.trim();
    status.textContent = note ? 'Review the transcript and dated details before saving.' : 'No words captured. Try again or type your check-in.';
    if (note) showVoiceReview(note);
  };
  try { recognition.start(); }
  catch { status.textContent = 'Could not start voice capture. Type your check-in below.'; }
}

function resetRecordButton() {
  const button = document.getElementById('recordBtn');
  button.classList.remove('is-recording');
  button.setAttribute('aria-pressed', 'false');
  button.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3Zm-7-3a7 7 0 0 0 14 0M12 18v4m-4 0h8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>&nbsp; Start voice check-in';
}

function reviewTypedCheckin() {
  const note = document.getElementById('voiceText').value.trim();
  if (!note) return toast('Speak or type a check-in first');
  showVoiceReview(note);
}

function refreshVoiceEvents() {
  const note = document.getElementById('reviewText').value.trim();
  voiceDraft = parseVoiceEvents(note);
  renderVoiceEvents();
}

function showVoiceReview(note) {
  document.getElementById('reviewText').value = note;
  refreshVoiceEvents();
  document.getElementById('voiceReview').classList.add('show');
  document.getElementById('addAsNote').checked = voiceDraft.length === 0;
  document.getElementById('voiceStatus').textContent = voiceDraft.length
    ? 'Check the dates and details. You can change or remove any suggestion.'
    : "I couldn't pick out dated details. Tick the box below to keep this note on your timeline.";
  document.getElementById('voiceReview').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function toggleSpokenTextEdit() {
  const container = document.getElementById('reviewTextContainer');
  const btn = document.getElementById('toggleTranscriptBtn');
  if (!container) return;
  const isHidden = container.style.display === 'none';
  container.style.display = isHidden ? 'block' : 'none';
  if (btn) btn.textContent = isHidden ? 'Hide words' : 'Edit words';
}

function addVoiceEvent() {
  const custom = prompt('What detail would you like to add? (e.g. Cramps, Headache, Spotting, Mood changes)');
  if (!custom || !custom.trim()) return;
  voiceDraft.push({ kind: 'symptom', title: custom.trim(), date: localISODate() });
  renderVoiceEvents();
}

function renderVoiceEvents() {
  const container = document.getElementById('voiceEvents');
  if (!voiceDraft.length) {
    container.innerHTML = '<p class="empty-state" style="padding:10px 0;font-size:12px;color:var(--muted)">No specific cycle details detected. Your check-in will still be kept in Records.</p>';
    return;
  }

  container.innerHTML = '';
  voiceDraft.forEach((event, index) => {
    const card = document.createElement('div');
    card.className = 'voice-event-card';

    const isPeriod = event.kind === 'period-start' || event.kind === 'period-end';
    const isContext = event.kind === 'context';
    const lowerTitle = (event.title || '').toLowerCase();
    const iconChar = isPeriod ? '🩸' : isContext ? '🏷' : (lowerTitle.includes('craving') ? '🍪' : lowerTitle.includes('bloat') || lowerTitle.includes('float') ? '🎈' : lowerTitle.includes('cramp') ? '⚡' : '✨');
    const iconClass = isPeriod ? 'period' : isContext ? 'context' : 'symptom';

    const left = document.createElement('div');
    left.className = 'voice-event-card-left';

    const icon = document.createElement('div');
    icon.className = `voice-event-icon ${iconClass}`;
    icon.textContent = iconChar;

    const meta = document.createElement('div');
    meta.className = 'voice-event-meta';

    const titleEl = document.createElement('div');
    titleEl.className = 'voice-event-title';
    titleEl.textContent = event.title || 'Check-in detail';

    const subEl = document.createElement('div');
    subEl.className = 'voice-event-sub';

    const dateChip = document.createElement('label');
    dateChip.className = 'voice-event-date-chip';
    dateChip.title = 'Click to change date';

    const todayStr = localISODate();
    const diffDays = dayNumber(todayStr) - dayNumber(event.date);
    const dateLabel = diffDays === 0 ? 'Today'
      : diffDays === 1 ? 'Yesterday'
      : diffDays > 1 && diffDays <= 7 ? `${diffDays} days ago`
      : formatDate(event.date, { month: 'short', day: 'numeric' });

    const dateText = document.createElement('span');
    dateText.textContent = `📅 ${dateLabel}`;

    const dateInput = document.createElement('input');
    dateInput.type = 'date';
    dateInput.value = event.date;
    dateInput.addEventListener('change', () => {
      event.date = dateInput.value;
      renderVoiceEvents();
    });

    dateChip.append(dateText, dateInput);
    subEl.append(dateChip);

    meta.append(titleEl, subEl);
    left.append(icon, meta);

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'voice-event-remove';
    removeBtn.setAttribute('aria-label', `Remove ${event.title}`);
    removeBtn.innerHTML = '&times;';
    removeBtn.title = 'Remove this detail';
    removeBtn.addEventListener('click', () => {
      voiceDraft.splice(index, 1);
      renderVoiceEvents();
    });

    card.append(left, removeBtn);
    container.append(card);
  });
}

function saveVoiceEntry() {
  const note = document.getElementById('reviewText').value.trim();
  if (!note) return toast('Add or dictate a note first');
  const sourceId = newID();
  const noteDate = localISODate();
  voiceNotes.unshift({ id: sourceId, date: noteDate, text: note });

  voiceDraft.forEach(event => {
    const title = event.title.trim();
    if (!title || !event.date) return;
    const type = event.kind.startsWith('period-') ? 'period' : event.kind;
    entries.push({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      id: newID(), sourceId, date: event.date, type, title,
      detail: 'Added from your reviewed voice check-in',
      dateSource: event.dateSource || 'inferred',
      periodRole: event.kind === 'period-start' ? 'start' : event.kind === 'period-end' ? 'end' : undefined
    });
  });

  if (document.getElementById('addAsNote')?.checked) {
    entries.push({
      schemaVersion: CURRENT_SCHEMA_VERSION, id: newID(), sourceId, date: noteDate,
      type: 'record', title: 'Check-in note', detail: note
    });
  }

  persistVoiceNotes();
  saveAndRender();
  document.getElementById('voiceText').value = '';
  document.getElementById('reviewText').value = '';
  document.getElementById('voiceReview').classList.remove('show');
  document.getElementById('voiceStatus').textContent = 'Saved. Your note and dated details are in your history.';
  voiceDraft = [];
  toast('Check-in and dated details saved');
}

function generateSummary() {
  const starts = periodStarts();
  const intervals = cycleIntervals();
  const durations = bleedingDurations();
  const cycleNotes = starts.length
    ? starts.map(entry => `• Period started: ${formatDate(entry.date)}${entry.detail && entry.detail !== 'Added by you' ? ` — ${entry.detail}` : ''}`)
    : ['• No period start dates recorded yet.'];
  if (intervals.length) {
    cycleNotes.push(...intervals.map(item => `• Cycle interval: ${formatDate(item.start.date)} to ${formatDate(item.end.date)} — ${item.days} days`));
  }
  cycleNotes.push(...(durations.length
    ? durations.map(item => `• Bleeding: ${formatDate(item.start.date)} to ${formatDate(item.end.date)} — ${item.days} days`)
    : ['• Bleeding duration: no start/end date pairs recorded yet.']));
  const notes = entries.filter(entry => !entry.sourceId && ['symptom', 'context', 'record'].includes(entry.type))
    .slice().sort((a, b) => a.date.localeCompare(b.date))
    .map(entry => `• ${formatDate(entry.date)} — ${entry.title}${entry.detail && entry.detail !== 'Added by you' ? `: ${entry.detail}` : ''}`);
  const spokenNotes = voiceNotes.slice().reverse()
    .map(note => `• ${formatDate(note.date)} — “${note.text}”`);
  const selectedDocuments = documents.filter(document => document.includeInSummary && ((document.notes && document.notes.trim()) || (document.keyFinding && document.keyFinding.trim())));
  const recordNotes = selectedDocuments.map(document => {
    const parts = [];
    if (document.category) parts.push(`[${document.category}]`);
    if (document.keyFinding) parts.push(`Key: ${document.keyFinding}`);
    if (document.notes) parts.push(document.notes);
    return `• ${document.name}${document.recordDate ? ` (${formatDate(document.recordDate)})` : ''} — ${parts.join(' · ') || 'Included'}`;
  });
  const analysis = analyze(entries, { today: localISODate(), rules: RULES });
  const flagLines = analysis.flags.length
    ? analysis.flags.map(f => `• ${f.title}: ${f.message}`)
    : ['• No out-of-range pattern flags under FIGO 2018 criteria.'];

  const section = (title, lines) => `${title}\n${lines.join('\n')}`;
  const value = [
    section('CYCLE DATES & LENGTHS', cycleNotes),
    section('PATTERNS WORTH DISCUSSING (FIGO 2018 criteria — pending clinical review)', flagLines),
    section('SYMPTOMS, CONTEXT & NOTES', notes.length ? notes : ['• No additional notes recorded.']),
    section('VOICE CHECK-INS', spokenNotes.length ? spokenNotes : ['• No voice check-ins recorded.']),
    section('MEDICAL RECORDS TO DISCUSS', recordNotes.length ? recordNotes : ['• No record notes selected.']),
    section('QUESTIONS FOR THE APPOINTMENT', ['• '])
  ].join('\n\n');
  const field = document.getElementById('summaryText');
  if (!field.value || field.dataset.generated === 'true') {
    field.value = value;
    field.dataset.generated = 'true';
  }
}

async function copySummary() {
  const field = document.getElementById('summaryText');
  if (!field.value) generateSummary();
  try {
    await navigator.clipboard.writeText(field.value);
    toast('Summary copied');
  } catch {
    field.select();
    document.execCommand('copy');
    toast('Summary copied');
  }
}

function renderClinicianBrief() {
  const container = document.getElementById('clinicalBriefContent');
  if (!container) return;

  const starts = periodStarts();
  const intervals = cycleIntervals();
  const durations = bleedingDurations();
  const analysis = analyze(entries, { today: localISODate(), rules: RULES });

  const earliestDate = starts.length ? starts[0].date : localISODate();
  const latestDate = starts.length ? starts[starts.length - 1].date : localISODate();

  let freqValue = '—';
  let freqSub = 'Insufficient data';
  let freqStatus = { text: 'Need 2+ starts', class: 'info' };
  if (analysis.summary) {
    freqValue = `${analysis.summary.min}–${analysis.summary.max} d`;
    freqSub = `Across last ${analysis.basedOnCycles} cycles`;
    const isNormal = analysis.summary.min >= 24 && analysis.summary.max <= 38;
    freqStatus = isNormal
      ? { text: 'Normal frequency (24–38d)', class: 'normal' }
      : { text: analysis.summary.max > 38 ? 'Infrequent / Variable (>38d)' : 'Frequent (<24d)', class: 'attention' };
  } else if (intervals.length) {
    const min = Math.min(...intervals.map(i => i.days));
    const max = Math.max(...intervals.map(i => i.days));
    freqValue = `${min}–${max} d`;
    freqSub = `${intervals.length} recorded interval${intervals.length === 1 ? '' : 's'}`;
  }

  let spreadValue = '—';
  let spreadSub = 'Difference (max - min)';
  let spreadStatus = { text: 'Pending data', class: 'info' };
  if (analysis.summary) {
    spreadValue = `±${analysis.summary.spread} days`;
    spreadSub = 'Spread between shortest & longest';
    spreadStatus = analysis.summary.spread <= 9
      ? { text: 'Regular spread (≤9 days)', class: 'normal' }
      : { text: `Irregular spread (${analysis.summary.spread}d > 9d)`, class: 'attention' };
  }

  let bleedValue = '—';
  let bleedSub = 'Start to end duration';
  let bleedStatus = { text: 'Need start + end dates', class: 'info' };
  if (durations.length) {
    const minD = Math.min(...durations.map(d => d.days));
    const maxD = Math.max(...durations.map(d => d.days));
    bleedValue = minD === maxD ? `${minD} days` : `${minD}–${maxD} days`;
    bleedSub = `Based on ${durations.length} recorded period${durations.length === 1 ? '' : 's'}`;
    bleedStatus = maxD <= 8
      ? { text: 'Normal duration (≤8 days)', class: 'normal' }
      : { text: 'Prolonged bleeding (>8 days)', class: 'attention' };
  }

  let gapValue = '—';
  let gapSub = 'Days since last start';
  let gapStatus = { text: 'No starts logged', class: 'info' };
  if (starts.length) {
    const lastStart = starts[starts.length - 1].date;
    const daysSince = Math.max(0, Math.round((Date.now() - Date.parse(`${lastStart}T12:00:00`)) / 86400000));
    gapValue = `${daysSince} days`;
    gapSub = `Since ${formatDate(lastStart)}`;
    gapStatus = daysSince > 90
      ? { text: 'Prolonged gap (>90d)', class: 'attention' }
      : { text: daysSince > 38 ? 'Current cycle length extended' : 'Current cycle in progress', class: daysSince > 38 ? 'attention' : 'normal' };
  }

  const contextMarkers = entries.filter(e => e.type === 'context').sort((a, b) => b.date.localeCompare(a.date));
  let interventionHTML = '<p class="empty-state">No medical or lifestyle context markers logged yet.</p>';
  if (contextMarkers.length) {
    const rows = contextMarkers.map(m => {
      const before = intervals.filter(i => i.end.date <= m.date).map(i => i.days);
      const after = intervals.filter(i => i.start.date >= m.date).map(i => i.days);
      const beforeStr = before.length ? `${Math.min(...before)}–${Math.max(...before)} d (n=${before.length})` : '—';
      const afterStr = after.length ? `${Math.min(...after)}–${Math.max(...after)} d (n=${after.length})` : '—';
      return `<tr>
        <td><strong>${escapeHTML(m.title)}</strong><br><small style="color:var(--muted)">${formatDate(m.date)} · ${escapeHTML(m.detail || 'Marked by you')}</small></td>
        <td>${beforeStr}</td>
        <td>${afterStr}</td>
      </tr>`;
    }).join('');
    interventionHTML = `<table class="brief-table">
      <thead><tr><th>Context Marker</th><th>Cycle Range Before</th><th>Cycle Range After</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  }

  const groupedSymptoms = new Map();
  entries.filter(e => e.type === 'symptom').forEach(e => {
    const name = e.title.trim();
    if (!name) return;
    const key = name.toLowerCase();
    const curr = groupedSymptoms.get(key);
    groupedSymptoms.set(key, { name: curr?.name || name, count: (curr?.count || 0) + 1 });
  });
  const topSymptoms = [...groupedSymptoms.values()].sort((a, b) => b.count - a.count);
  const symptomsHTML = topSymptoms.length
    ? `<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px">${topSymptoms.map(s => `<span class="tag plum" style="font-size:12px;padding:4px 10px">${escapeHTML(s.name)} <strong>(${s.count}×)</strong></span>`).join('')}</div>`
    : '<p class="empty-state">No symptoms recorded yet.</p>';

  const selectedDocs = documents.filter(d => d.includeInSummary && ((d.notes && d.notes.trim()) || (d.keyFinding && d.keyFinding.trim())));
  const docsHTML = selectedDocs.length
    ? `<ul style="margin:8px 0 0 18px;padding:0;font-size:13px;color:var(--ink)">${selectedDocs.map(d => `<li style="margin-bottom:6px"><strong>${escapeHTML(d.name)}</strong>${d.category ? ` <span class="tag lab-tag" style="font-size:10px;padding:2px 7px">${escapeHTML(d.category)}</span>` : ''}${d.recordDate ? ` (${formatDate(d.recordDate)})` : ''}: ${d.keyFinding ? `<span style="color:#0369a1;font-weight:600">${escapeHTML(d.keyFinding)}</span>${d.notes ? ' · ' : ''}` : ''}${escapeHTML(d.notes || '')}</li>`).join('')}</ul>`
    : '<p class="empty-state">No document notes selected for this appointment.</p>';

  const questions = [];
  if (analysis.flags.some(f => f.id === 'variable_cycles' || f.id === 'long_cycles')) {
    questions.push(`“My recorded cycle lengths vary by ${analysis.summary ? analysis.summary.spread : '>9'} days. Would you recommend blood work (e.g. TSH, prolactin, free testosterone) or a pelvic ultrasound to investigate potential hormonal factors?”`);
  }
  if (analysis.flags.some(f => f.id === 'long_bleeding')) {
    questions.push('“My bleeding duration has reached over 8 days on several cycles. What could be contributing to prolonged bleeding, and should we evaluate for iron deficiency or polyps?”');
  }
  if (analysis.flags.some(f => f.id === 'long_gap')) {
    questions.push(`“It has been over 90 days since my last period start. What is the standard protocol for inducing a cycle or investigating secondary amenorrhea?”`);
  }
  if (contextMarkers.length) {
    questions.push(`“I recorded ${contextMarkers[0].title} on ${formatDate(contextMarkers[0].date)}. Could there be any connection between this shift and the cycle variance I'm seeing?”`);
  }
  if (!questions.length) {
    questions.push('“Given my recorded cycle range and symptoms, are there any preventive screenings or baseline tests you recommend discussing today?”');
  }

  const questionsHTML = `<div class="question-list">${questions.map((q, idx) => `<div class="question-item"><span class="question-num">Q${idx + 1}</span><span>${escapeHTML(q)}</span></div>`).join('')}</div>`;

  container.innerHTML = `
    <div class="brief-header">
      <div class="brief-header-top">
        <div>
          <span style="font-size:11px;font-weight:700;letter-spacing:1px;color:var(--plum);text-transform:uppercase">Cycle Context · Clinical Consultation Brief</span>
          <h2>Patient Cycle &amp; Symptom Summary</h2>
        </div>
        <div class="brief-meta">
          <strong>Prepared:</strong> ${formatDate(localISODate())}<br>
          <strong>Observation Window:</strong> ${formatDate(earliestDate)} – ${formatDate(latestDate)} (${starts.length} period start${starts.length === 1 ? '' : 's'})
        </div>
      </div>
      <div class="brief-disclaimer">
        <strong>Note for Healthcare Provider:</strong> This brief is compiled directly from personal health journals kept by the patient on their device. Cycle variation and duration metrics are benchmarked against FIGO (International Federation of Gynecology and Obstetrics) 2018 clinical definitions to assist in your evaluation. It does not contain automated diagnoses or algorithmic treatments.
      </div>
    </div>

    <div class="brief-section">
      <div class="brief-section-title">1. FIGO Menstrual History Metrics</div>
      <div class="clinical-grid">
        <div class="clinical-metric-card">
          <div>
            <div class="clinical-metric-label">Cycle Frequency</div>
            <div class="clinical-metric-value">${freqValue}</div>
            <div class="clinical-metric-sub">${freqSub}</div>
          </div>
          <span class="clinical-status-pill ${freqStatus.class}">${freqStatus.text}</span>
        </div>
        <div class="clinical-metric-card">
          <div>
            <div class="clinical-metric-label">Regularity Spread</div>
            <div class="clinical-metric-value">${spreadValue}</div>
            <div class="clinical-metric-sub">${spreadSub}</div>
          </div>
          <span class="clinical-status-pill ${spreadStatus.class}">${spreadStatus.text}</span>
        </div>
        <div class="clinical-metric-card">
          <div>
            <div class="clinical-metric-label">Bleeding Duration</div>
            <div class="clinical-metric-value">${bleedValue}</div>
            <div class="clinical-metric-sub">${bleedSub}</div>
          </div>
          <span class="clinical-status-pill ${bleedStatus.class}">${bleedStatus.text}</span>
        </div>
        <div class="clinical-metric-card">
          <div>
            <div class="clinical-metric-label">Current Cycle Gap</div>
            <div class="clinical-metric-value">${gapValue}</div>
            <div class="clinical-metric-sub">${gapSub}</div>
          </div>
          <span class="clinical-status-pill ${gapStatus.class}">${gapStatus.text}</span>
        </div>
      </div>
    </div>

    <div class="brief-section">
      <div class="brief-section-title">2. Context Milestones &amp; Interventions</div>
      ${interventionHTML}
    </div>

    <div class="brief-section">
      <div class="brief-section-title">3. Reported Symptoms Profile</div>
      ${symptomsHTML}
    </div>

    <div class="brief-section">
      <div class="brief-section-title">4. Medical Records &amp; Documents Selected</div>
      ${docsHTML}
    </div>

    <div class="brief-section">
      <div class="brief-section-title">5. Prepared Questions for Your Doctor</div>
      ${questionsHTML}
    </div>
  `;
}

function switchSummaryView(mode) {
  const briefBtn = document.getElementById('viewBriefBtn');
  const rawBtn = document.getElementById('viewRawBtn');
  const briefContainer = document.getElementById('briefViewContainer');
  const rawContainer = document.getElementById('rawViewContainer');

  if (mode === 'brief') {
    briefBtn.classList.add('active');
    rawBtn.classList.remove('active');
    briefContainer.hidden = false;
    rawContainer.hidden = true;
    renderClinicianBrief();
  } else {
    rawBtn.classList.add('active');
    briefBtn.classList.remove('active');
    briefContainer.hidden = true;
    rawContainer.hidden = false;
    generateSummary();
  }
}

function printSummary() {
  renderClinicianBrief();
  window.print();
}


function openDocumentDatabase() {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DOCUMENT_DB, 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(DOCUMENT_STORE)) {
        request.result.createObjectStore(DOCUMENT_STORE, { keyPath: 'id' });
      }
      if (!request.result.objectStoreNames.contains(DOCUMENT_FILE_STORE)) {
        request.result.createObjectStore(DOCUMENT_FILE_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return databasePromise;
}

async function getAllDocuments() {
  const db = await openDocumentDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction(DOCUMENT_STORE).objectStore(DOCUMENT_STORE).getAll();
    request.onsuccess = () => resolve(request.result.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt)));
    request.onerror = () => reject(request.error);
  });
}

async function getDocument(id) {
  const db = await openDocumentDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction(DOCUMENT_FILE_STORE).objectStore(DOCUMENT_FILE_STORE).get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function putDocument(documentRecord) {
  const db = await openDocumentDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([DOCUMENT_STORE, DOCUMENT_FILE_STORE], 'readwrite');
    const { blob, ...metadata } = documentRecord;
    transaction.objectStore(DOCUMENT_STORE).put(metadata);
    if (blob) transaction.objectStore(DOCUMENT_FILE_STORE).put({ id: documentRecord.id, blob });
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
}

async function handleDocumentFiles(input) {
  const files = [...input.files];
  input.value = '';
  for (const file of files) {
    if (file.size > MAX_FILE_SIZE) {
      toast(`${file.name} is larger than 25 MB and was skipped`);
      continue;
    }
    try {
      await putDocument({
        id: newID(), name: file.name, mime: file.type || 'File', size: file.size,
        uploadedAt: localISODate(), recordDate: '', notes: '', includeInSummary: false, blob: file
      });
    } catch {
      toast('This browser could not save the document. Try another browser.');
      return;
    }
  }
  await loadDocuments();
  if (files.length) toast(`${files.length} document${files.length === 1 ? '' : 's'} added to this device`);
}

async function loadDocuments() {
  try {
    documents = await getAllDocuments();
  } catch {
    documents = [];
    toast('Private document storage is not available in this browser');
  }
  renderDocuments();
  renderTimelineOnly();
}

function formatFileSize(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function renderDocuments() {
  const list = document.getElementById('documentsList');
  document.getElementById('documentCount').textContent = `${documents.length} file${documents.length === 1 ? '' : 's'}`;
  document.getElementById('recordSummaryCount').textContent = `${documents.length} file${documents.length === 1 ? '' : 's'} · ${entries.filter(entry => entry.type === 'record').length} note${entries.filter(entry => entry.type === 'record').length === 1 ? '' : 's'}`;
  const latestNote = entries.filter(entry => entry.type === 'record').sort((a, b) => b.date.localeCompare(a.date))[0];
  document.getElementById('recordSummaryPreview').innerHTML = documents.length
    ? `<div><strong>${escapeHTML(documents[0].name)}</strong><small>${documents.length} private file${documents.length === 1 ? '' : 's'} on this device</small></div><span class="tag green">Private</span>`
    : latestNote
      ? `<div><strong>${escapeHTML(latestNote.title)}</strong><small>Added by you · ${formatDate(latestNote.date)}</small></div><span class="tag green">Private</span>`
      : '<div><strong>Your private record library</strong><small>Reports and notes stay on this device</small></div>';

  if (!documents.length) {
    list.innerHTML = '<p class="empty-state">No documents added yet.</p>';
    return;
  }

  list.innerHTML = '';
  documents.forEach(documentRecord => {
    const article = document.createElement('article');
    article.className = 'document-record';
    const heading = document.createElement('div');
    heading.className = 'document-record-heading';
    const title = document.createElement('strong');
    title.textContent = documentRecord.name;
    const info = document.createElement('small');
    info.textContent = `${documentRecord.mime} · ${formatFileSize(documentRecord.size)} · added ${formatDate(documentRecord.uploadedAt)}`;
    heading.append(title, info);

    const fieldsGrid = document.createElement('div');
    fieldsGrid.className = 'document-record-fields';

    const catLabel = document.createElement('label');
    catLabel.textContent = 'Report category';
    const catSelect = document.createElement('select');
    const categories = [
      'Blood / Hormone panel',
      'Pelvic / Follicle Ultrasound',
      'Clinician consultation note',
      'Prescription / Medication',
      'Pathology / Lab report',
      'Other medical report'
    ];
    categories.forEach(cat => {
      const opt = document.createElement('option');
      opt.value = cat;
      opt.textContent = cat;
      if ((documentRecord.category || 'Blood / Hormone panel') === cat) opt.selected = true;
      catSelect.append(opt);
    });
    catLabel.append(catSelect);

    const dateLabel = document.createElement('label');
    dateLabel.textContent = 'Date on report';
    const date = document.createElement('input');
    date.type = 'date';
    date.value = documentRecord.recordDate || '';
    dateLabel.append(date);

    const findingLabel = document.createElement('label');
    findingLabel.textContent = 'Key finding / value (optional)';
    const findingInput = document.createElement('input');
    findingInput.type = 'text';
    findingInput.placeholder = 'e.g. TSH: 1.8 mIU/L, Follicles: 14';
    findingInput.value = documentRecord.keyFinding || '';
    findingLabel.append(findingInput);

    fieldsGrid.append(catLabel, dateLabel, findingLabel);

    const noteLabel = document.createElement('label');
    noteLabel.textContent = 'Your note or questions about this report';
    const note = document.createElement('textarea');
    note.value = documentRecord.notes || '';
    note.placeholder = 'What would you like to remember or discuss with your doctor?';
    noteLabel.append(note);

    const checkContainer = document.createElement('div');
    checkContainer.className = 'document-record-checkboxes';

    const timelineLabel = document.createElement('label');
    const timelineCheck = document.createElement('input');
    timelineCheck.type = 'checkbox';
    timelineCheck.checked = documentRecord.showOnTimeline !== false;
    timelineLabel.append(timelineCheck, document.createTextNode('Show on cycle timeline'));

    const summaryLabel = document.createElement('label');
    const summaryCheck = document.createElement('input');
    summaryCheck.type = 'checkbox';
    summaryCheck.checked = Boolean(documentRecord.includeInSummary);
    summaryLabel.append(summaryCheck, document.createTextNode('Include in clinician appointment brief'));

    checkContainer.append(timelineLabel, summaryLabel);

    const actions = document.createElement('div');
    actions.className = 'document-actions';
    const save = document.createElement('button');
    save.className = 'btn';
    save.textContent = 'Save changes';
    save.addEventListener('click', () => updateDocument(documentRecord.id, {
      category: catSelect.value,
      recordDate: date.value,
      keyFinding: findingInput.value.trim(),
      notes: note.value.trim(),
      showOnTimeline: timelineCheck.checked,
      includeInSummary: summaryCheck.checked
    }));
    const download = document.createElement('button');
    download.className = 'text-button';
    download.textContent = 'Download original';
    download.addEventListener('click', () => downloadDocument(documentRecord));
    const remove = document.createElement('button');
    remove.className = 'text-button remove-document';
    remove.textContent = 'Remove';
    remove.addEventListener('click', () => removeDocument(documentRecord.id));
    actions.append(save, download, remove);
    article.append(heading, fieldsGrid, noteLabel, checkContainer, actions);
    list.append(article);
  });
}

async function updateDocument(id, changes) {
  const documentRecord = documents.find(item => item.id === id);
  if (!documentRecord) return;
  Object.assign(documentRecord, changes);
  await putDocument({ ...documentRecord, ...changes });
  documents = documents.map(item => item.id === id ? documentRecord : item);
  renderDocuments();
  renderTimelineOnly();
  renderClinicianBrief();
  toast('Document record saved on this device');
}

async function downloadDocumentById(id) {
  const documentRecord = documents.find(item => item.id === id);
  if (documentRecord) await downloadDocument(documentRecord);
}

async function downloadDocument(documentRecord) {
  const storedDocument = await getDocument(documentRecord.id);
  const url = URL.createObjectURL(storedDocument.blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = documentRecord.name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function removeDocument(id) {
  if (!confirm('Remove this document and its notes from this device?')) return;
  const db = await openDocumentDatabase();
  await new Promise((resolve, reject) => {
    const transaction = db.transaction([DOCUMENT_STORE, DOCUMENT_FILE_STORE], 'readwrite');
    transaction.objectStore(DOCUMENT_STORE).delete(id);
    transaction.objectStore(DOCUMENT_FILE_STORE).delete(id);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
  await loadDocuments();
}

async function resetData() {
  if (!confirm('Clear your entries and documents from this device and restore the sample timeline?')) return;
  localStorage.removeItem(ENTRY_KEY);
  localStorage.removeItem(VOICE_KEY);
  entries = SAMPLE_ENTRIES.slice();
  voiceNotes = [];
  const db = await openDocumentDatabase();
  await new Promise((resolve, reject) => {
    const transaction = db.transaction([DOCUMENT_STORE, DOCUMENT_FILE_STORE], 'readwrite');
    transaction.objectStore(DOCUMENT_STORE).clear();
    transaction.objectStore(DOCUMENT_FILE_STORE).clear();
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
  await loadDocuments();
  render();
  toast('Sample timeline restored');
}

function initialize() {
  migrateOldVoiceEntries();
  render();
  loadDocuments().then(generateSummary);
}

function migrateOldVoiceEntries() {
  const oldNotes = entries.filter(entry => entry.type === 'voice');
  if (!oldNotes.length) return;
  voiceNotes = [...oldNotes.map(entry => ({ id: entry.id || newID(), date: entry.date, text: entry.detail || entry.title })), ...voiceNotes];
  entries = entries.filter(entry => entry.type !== 'voice');
  persistVoiceNotes();
  persistEntries();
}

Object.assign(window, {
  go,
  openLog,
  closeModal,
  saveEntry,
  setType,
  toggleChip,
  toggleRecording,
  reviewTypedCheckin,
  addVoiceEvent,
  saveVoiceEntry,
  generateSummary,
  copySummary,
  switchSummaryView,
  printSummary,
  selectChangeMarker,
  switchSymptomView,
  filterTimeline,
  downloadDocumentById,
  toggleSpokenTextEdit,
  refreshVoiceEvents,
  resetData,
  handleDocumentFiles,
  removeDocument
});

initialize();

