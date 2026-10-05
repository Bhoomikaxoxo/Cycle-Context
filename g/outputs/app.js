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

function timelineMarkup(list) {
  const visibleEntries = list.filter(entry => entry.type !== 'voice-source');
  if (!visibleEntries.length) {
    return '<p class="empty-state">Nothing on your timeline yet. Add a period date or check-in to begin.</p>';
  }

  return visibleEntries.slice().sort((a, b) => b.date.localeCompare(a.date)).map(entry => {
    const sourceTag = entry.sourceId ? '<button class="text-button timeline-source" onclick="go(\'records\')">View original voice note</button>' : '';
    const typeLabel = entry.type === 'period' ? 'Cycle event'
      : entry.type === 'context' ? 'Context marker'
      : entry.type === 'record' ? 'Note added by you'
      : 'Check-in';
    return `<div class="event ${entry.type === 'context' ? 'marker' : ''}">
      <div class="event-date">${formatDate(entry.date, { month: 'short', day: 'numeric' })} · ${new Date(`${entry.date}T12:00:00`).getFullYear()}</div>
      <div class="event-text"><strong>${escapeHTML(entry.title)}</strong>${escapeHTML(entry.detail || '')}<br>
      <span class="tag ${entry.type === 'period' ? 'plum' : entry.type === 'context' || entry.type === 'record' ? 'green' : ''}">${typeLabel}</span>${sourceTag}</div>
    </div>`;
  }).join('');
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
  })).filter(interval => interval.days > 0 && interval.days < 200);
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

function renderChangeComparison() {
  const markers = entries.filter(entry => entry.type === 'context').sort((a, b) => b.date.localeCompare(a.date));
  const label = document.getElementById('changeMarkerLabel');
  const target = document.getElementById('changeCompare');
  if (!markers.length) {
    label.textContent = 'Personal markers';
    target.innerHTML = '<p class="empty-state">Mark a change on your timeline to compare the cycle history before and after it.</p>';
    return;
  }

  const marker = markers[0];
  const intervals = cycleIntervals();
  const before = intervals.filter(item => item.end.date <= marker.date);
  const after = intervals.filter(item => item.end.date > marker.date);
  label.textContent = `${marker.title} · ${formatDate(marker.date, { month: 'short', day: 'numeric' })}`;
  target.innerHTML = `<div class="comparison"><h4>${escapeHTML(marker.title)}</h4><p>Cycle lengths recorded on either side of this date.</p>
    <div class="split"><div><small>Before · ${before.length} interval${before.length === 1 ? '' : 's'}</small><strong>${rangeText(before)}</strong></div>
    <div><small>After · ${after.length} interval${after.length === 1 ? '' : 's'}</small><strong>${rangeText(after)}</strong></div></div>
  </div><div class="callout">This comparison shows timing in your records. It does not show that the marker caused a change.</div>`;
}

function renderSymptomPatterns() {
  const grouped = new Map();
  entries.filter(entry => entry.type === 'symptom').forEach(entry => {
    const key = entry.title.trim();
    if (key) grouped.set(key, (grouped.get(key) || 0) + 1);
  });
  const items = [...grouped.entries()].sort((a, b) => b[1] - a[1]);
  const target = document.getElementById('symptomPatterns');
  target.innerHTML = items.length ? items.map(([name, count]) => `<div class="report-row"><div><strong>${escapeHTML(name)}</strong><small>Logged ${count} time${count === 1 ? '' : 's'}</small></div><span class="tag plum">${count}</span></div>`).join('')
    : '<p class="empty-state">Symptoms mentioned in reviewed check-ins will appear here as dated entries.</p>';
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
  const ordered = entries.slice().sort((a, b) => b.date.localeCompare(a.date));
  document.getElementById('recentTimeline').innerHTML = timelineMarkup(ordered.slice(0, 4));
  document.getElementById('fullTimeline').innerHTML = timelineMarkup(ordered);
  document.getElementById('eventTotal').textContent = `${ordered.filter(entry => entry.type !== 'voice-source').length} entries`;
  renderStats();
  renderCycleChart();
  renderChangeComparison();
  renderSymptomPatterns();
  renderInsight();
  renderRecordNotes();
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
    symptom: ['Lower energy', 'Pelvic discomfort', 'Cramps', 'Sleep changes', 'Mood changes', 'Headache', 'Other'],
    context: ['Medication change', 'Routine change', 'Stressful period', 'Weight change', 'Clinician-recorded diagnosis', 'Other'],
    record: ['Clinician note', 'Test result note', 'Other note']
  };
  document.getElementById('modalTitle').textContent = labels[type];
  document.getElementById('entryTitle').innerHTML = options[type].map(option => `<option>${escapeHTML(option)}</option>`).join('');
}

function closeModal() {
  document.getElementById('modalBackdrop').classList.remove('show');
}

function saveEntry() {
  const date = document.getElementById('entryDate').value;
  if (!date) return toast('Choose a date first');
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
    status.textContent = 'Voice capture is not available here. Type your check-in and review it below.';
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
  document.getElementById('voiceStatus').textContent = 'Check the dates and details. You can change or remove any suggestion.';
  document.getElementById('voiceReview').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function addVoiceEvent() {
  voiceDraft.push({ kind: 'symptom', title: '', date: localISODate() });
  renderVoiceEvents();
}

function renderVoiceEvents() {
  const container = document.getElementById('voiceEvents');
  if (!voiceDraft.length) {
    container.innerHTML = '<p class="empty-state">No details suggested. Your original note will still be saved. Add a detail if you want it in the cycle history.</p>';
    return;
  }

  container.innerHTML = '';
  voiceDraft.forEach((event, index) => {
    const row = document.createElement('div');
    row.className = 'voice-event-row';
    const kind = document.createElement('select');
    kind.setAttribute('aria-label', 'Detail type');
    eventKinds.forEach(([value, label]) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      kind.append(option);
    });
    kind.value = event.kind;
    kind.addEventListener('change', () => { event.kind = kind.value; });

    const title = document.createElement('input');
    title.type = 'text';
    title.value = event.title;
    title.placeholder = 'What happened?';
    title.setAttribute('aria-label', 'Edit detail');
    title.addEventListener('input', () => { event.title = title.value; });

    const date = document.createElement('input');
    date.type = 'date';
    date.value = event.date;
    date.setAttribute('aria-label', 'Date for this detail');
    date.addEventListener('change', () => { event.date = date.value; });

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'remove-event';
    remove.textContent = 'Remove';
    remove.addEventListener('click', () => {
      voiceDraft.splice(index, 1);
      renderVoiceEvents();
    });

    const badge = document.createElement('span');
    const isUncertain = event.dateSource === 'inferred' || event.dateSource === 'defaulted';
    badge.className = `tag ${isUncertain ? 'amber' : 'green'}`;
    badge.textContent = event.dateSource === 'inferred' ? 'Inferred date' : event.dateSource === 'defaulted' ? 'Defaulted date' : 'Spoken date';
    badge.title = isUncertain ? 'Derived from sentence context. You can change this date.' : 'Extracted directly from your check-in.';

    row.append(kind, title, date, badge, remove);
    container.append(row);
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
  const selectedDocuments = documents.filter(document => document.includeInSummary && document.notes.trim());
  const recordNotes = selectedDocuments.map(document => `• ${document.name}${document.recordDate ? ` (${formatDate(document.recordDate)})` : ''} — ${document.notes}`);
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

    const dateLabel = document.createElement('label');
    dateLabel.textContent = 'Date on report';
    const date = document.createElement('input');
    date.type = 'date';
    date.value = documentRecord.recordDate || '';
    date.addEventListener('change', () => updateDocument(documentRecord.id, { recordDate: date.value }));
    dateLabel.append(date);

    const noteLabel = document.createElement('label');
    noteLabel.textContent = 'Your note about this document';
    const note = document.createElement('textarea');
    note.value = documentRecord.notes || '';
    note.placeholder = 'What would you like to remember or discuss?';
    note.addEventListener('input', () => { documentRecord.notes = note.value; });
    noteLabel.append(note);

    const summaryLabel = document.createElement('label');
    summaryLabel.className = 'include-record';
    const include = document.createElement('input');
    include.type = 'checkbox';
    include.checked = Boolean(documentRecord.includeInSummary);
    include.addEventListener('change', () => updateDocument(documentRecord.id, { includeInSummary: include.checked }));
    summaryLabel.append(include, document.createTextNode('Include my note in the appointment summary'));

    const actions = document.createElement('div');
    actions.className = 'document-actions';
    const save = document.createElement('button');
    save.className = 'btn';
    save.textContent = 'Save note';
    save.addEventListener('click', () => updateDocument(documentRecord.id, { notes: note.value, recordDate: date.value }));
    const download = document.createElement('button');
    download.className = 'text-button';
    download.textContent = 'Download original';
    download.addEventListener('click', () => downloadDocument(documentRecord));
    const remove = document.createElement('button');
    remove.className = 'text-button remove-document';
    remove.textContent = 'Remove';
    remove.addEventListener('click', () => removeDocument(documentRecord.id));
    actions.append(save, download, remove);
    article.append(heading, dateLabel, noteLabel, summaryLabel, actions);
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
  toast('Document record saved on this device');
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
  toggleRecording,
  reviewTypedCheckin,
  addVoiceEvent,
  saveVoiceEntry,
  generateSummary,
  copySummary,
  resetData,
  handleDocumentFiles,
  removeDocument
});

initialize();

