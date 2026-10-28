import { RULES, analyze } from "./modules/analysis.js";
import { parseVoiceEvents } from "./modules/extraction.js";
import {
  extractReportDetails,
  extractReportDate,
} from "./modules/report-extraction.js";
import {
  COMMON_MEDICATION_PRESETS,
  calculateRegimenDuration,
  formatRegimenLine,
  filterMedicationsByWindow,
  filterMedicationsByStatus,
} from "./modules/medications.js";
import {
  generateCycleSparklineSVG,
  buildExecutiveSummaryData,
  formatClinicalDate,
} from "./modules/brief-visuals.js";
import {
  analyzeSymptomCorrelations,
  filterCorrelations,
  buildSymptomCycleMatrix,
  determineEntryPhase,
  PHASE_CONFIG,
} from "./modules/symptom-correlation.js";

const CURRENT_SCHEMA_VERSION = 1;

const SAMPLE_HORMONE_REPORT = `PATIENT LAB REPORT
Collection Date: 14 Oct 2024
Report Date: 15 Oct 2024

TEST NAME                          RESULT    UNITS       REFERENCE INTERVAL
Thyroid Stimulating Hormone (TSH)  2.45      mIU/L       (0.40 - 4.20)
Total Testosterone                 54        ng/dL       (15 - 70)
Free Testosterone                  4.2       pg/mL       (1.0 - 6.4)
Prolactin                          16.8      ng/mL       (4.8 - 23.3)
Estradiol (E2)                     62        pg/mL       (30 - 120)
FSH                                5.6       mIU/mL      (3.5 - 12.5)
LH                                 12.8      mIU/mL      (2.4 - 12.6)
AMH (Anti-Müllerian Hormone)       5.8       ng/mL       (1.0 - 4.0)
Progesterone                       0.6       ng/mL       (0.2 - 1.5)
DHEA-Sulfate                       260       ug/dL       (65 - 380)
Fasting Insulin                    9.2       uIU/mL      (2.6 - 24.9)
HbA1c                              5.3       %           (4.0 - 5.6)
Ferritin                           42        ng/mL       (15 - 150)`;

const SAMPLE_ULTRASOUND_REPORT = `PELVIC ULTRASOUND REPORT
Date of Exam: 2024-09-18
Indication: Irregular menstrual cycles, rule out PCOS.

FINDINGS:
Endometrial thickness: 6.8 mm, regular, trilaminar appearance.
Right Ovary: Volume 8.6 cm3. Antral follicle count: 14 follicles measuring 2-8 mm in peripheral distribution.
Left Ovary: Volume 9.2 cm3. Antral follicle count: 16 follicles in peripheral distribution.
Total AFC: 30 follicles.
Free fluid: None in the pouch of Douglas.

IMPRESSION:
Features compatible with polycystic ovarian morphology (PCOM) based on bilateral elevated follicle count.`;

let currentExtractionDocId = null;
let candidateFindings = [];

const SAMPLE_ENTRIES = [
  // Cycle 4 (Sep 06)
  {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    date: "2026-09-06",
    type: "period",
    title: "Period started",
    detail: "Flow: moderate",
  },
  {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    date: "2026-09-10",
    type: "period",
    title: "Period ended",
    detail: "Flow: light",
  },
  {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    date: "2026-09-07",
    type: "symptom",
    title: "Pelvic discomfort",
    detail: "Day 2 pelvic cramping, managed with heat pack",
  },

  // Cycle 3 (Jul 24 to Sep 06 - 44 days)
  {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    date: "2026-08-31",
    type: "symptom",
    title: "Lower energy",
    detail: "Noticed during the week before bleeding (6d before)",
  },
  {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    date: "2026-08-26",
    type: "symptom",
    title: "Sleep changes",
    detail: "Restless sleep recorded in evening",
  },
  {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    date: "2026-07-24",
    type: "period",
    title: "Period started",
    detail: "Flow: light",
  },
  {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    date: "2026-07-28",
    type: "period",
    title: "Period ended",
    detail: "Flow: light",
  },
  {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    date: "2026-07-25",
    type: "symptom",
    title: "Pelvic discomfort",
    detail: "Day 2 mild aching",
  },

  // Cycle 2 (Jun 08 to Jul 24 - 46 days)
  {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    date: "2026-07-20",
    type: "symptom",
    title: "Lower energy",
    detail: "Pre-menstrual fatigue (4d before bleeding)",
  },
  {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    date: "2026-06-24",
    type: "symptom",
    title: "Pelvic discomfort",
    detail: "Mid-cycle twinge (~Day 16)",
  },
  {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    date: "2026-06-08",
    type: "period",
    title: "Period started",
    detail: "Flow: moderate",
  },
  {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    date: "2026-06-12",
    type: "period",
    title: "Period ended",
    detail: "Flow: moderate",
  },
  {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    date: "2026-06-09",
    type: "symptom",
    title: "Pelvic discomfort",
    detail: "Day 2 cramping",
  },

  // Cycle 1 (May 03 to Jun 08 - 36 days)
  {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    date: "2026-06-03",
    type: "symptom",
    title: "Lower energy",
    detail: "Sluggish feeling 5 days before period",
  },
  {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    date: "2026-05-14",
    type: "context",
    title: "Routine change",
    detail: "Marked by you",
  },
  {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    date: "2026-05-03",
    type: "period",
    title: "Period started",
    detail: "Flow: moderate",
  },
  {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    date: "2026-05-07",
    type: "period",
    title: "Period ended",
    detail: "Flow: light",
  },
  {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    date: "2026-05-04",
    type: "symptom",
    title: "Pelvic discomfort",
    detail: "Day 2 pelvic aching",
  },
  {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    date: "2026-04-12",
    type: "record",
    title: "Clinician note",
    detail: "Follow-up planned in three months",
  },
];

const ENTRY_KEY = "cycleContextEntries";
const VOICE_KEY = "cycleContextVoiceNotes";
const MEDICATIONS_KEY = "cycleContextMedications";
const CUSTOM_QUESTIONS_KEY = "cycleContextCustomQuestions";
const DISABLED_QUESTIONS_KEY = "cycleContextDisabledQuestions";
const DOCUMENT_DB = "cycle-context-private-records";
const DOCUMENT_STORE = "documents";
const DOCUMENT_FILE_STORE = "document-files";
const MAX_FILE_SIZE = 25 * 1024 * 1024;

const SAMPLE_MEDICATIONS = [
  {
    id: "med-sample-1",
    name: "Myo-Inositol",
    category: "supplement",
    dosage: "2,000 mg",
    frequency: "Twice daily with meals",
    startDate: "2026-06-15",
    endDate: null,
    status: "active",
    notes:
      "40:1 Myo to D-Chiro blend for ovulatory support and insulin sensitivity",
    includeInSummary: true,
    createdAt: "2026-06-15T09:00:00Z",
  },
  {
    id: "med-sample-2",
    name: "Metformin",
    category: "medication",
    dosage: "500 mg",
    frequency: "Once daily with dinner",
    startDate: "2026-08-01",
    endDate: null,
    status: "active",
    notes: "Prescribed by Dr. Mehta for cycle length regularity",
    includeInSummary: true,
    createdAt: "2026-08-01T10:00:00Z",
  },
];

let entries = readJSON(ENTRY_KEY, SAMPLE_ENTRIES);
let voiceNotes = readJSON(VOICE_KEY, []);
let medications = readJSON(MEDICATIONS_KEY, SAMPLE_MEDICATIONS);
let currentEditingMedId = null;
let customQuestions = readJSON(CUSTOM_QUESTIONS_KEY, []);
let disabledQuestionIds = new Set(readJSON(DISABLED_QUESTIONS_KEY, []));
let currentType = "period";
let voiceDraft = [];
let recognition = null;
let isRecording = false;
let documents = [];
let databasePromise;

let currentSummaryRange = "all"; // 'all' | '3m' | '6m' | '12m' | 'custom'
let summaryCustomStart = null;
let summaryCustomEnd = null;

function persistCustomQuestions() {
  localStorage.setItem(CUSTOM_QUESTIONS_KEY, JSON.stringify(customQuestions));
}

function persistDisabledQuestions() {
  localStorage.setItem(
    DISABLED_QUESTIONS_KEY,
    JSON.stringify(Array.from(disabledQuestionIds)),
  );
}

const PRINT_PREFS_KEY = "cycleContextPrintPrefs";
const DEFAULT_PRINT_PREFS = {
  patientRef: "",
  physicianRef: "",
  compactOnePage: true,
  sections: {
    execSummary: true,
    sparkline: true,
    figo: true,
    population: true,
    meds: true,
    context: true,
    symptoms: true,
    docs: true,
    agenda: true,
  },
};
let printPrefs = readJSON(PRINT_PREFS_KEY, DEFAULT_PRINT_PREFS);
if (!printPrefs || typeof printPrefs !== "object")
  printPrefs = { ...DEFAULT_PRINT_PREFS };
if (!printPrefs.sections)
  printPrefs.sections = { ...DEFAULT_PRINT_PREFS.sections };

function persistPrintPrefs() {
  localStorage.setItem(PRINT_PREFS_KEY, JSON.stringify(printPrefs));
}

function togglePrintSection(secKey) {
  if (!printPrefs.sections)
    printPrefs.sections = { ...DEFAULT_PRINT_PREFS.sections };
  printPrefs.sections[secKey] = !printPrefs.sections[secKey];
  persistPrintPrefs();
  renderClinicianBrief();
}

function toggleCompactPrint(isCompact) {
  printPrefs.compactOnePage = Boolean(isCompact);
  persistPrintPrefs();
  renderClinicianBrief();
}

function updatePrintMeta(key, value) {
  printPrefs[key] = value;
  persistPrintPrefs();
  const el = document.getElementById(
    key === "patientRef" ? "headerPatientRef" : "headerPhysicianRef",
  );
  if (el) {
    el.textContent = value.trim()
      ? value.trim()
      : key === "patientRef"
        ? "Patient Journal"
        : "";
  }
}

function updateBriefOptionsUI() {
  if (!printPrefs || !printPrefs.sections) return;
  Object.keys(printPrefs.sections).forEach((sec) => {
    const chk = document.getElementById(`secToggle_${sec}`);
    if (chk) chk.checked = Boolean(printPrefs.sections[sec]);
  });
  const compactBtn = document.getElementById("densityCompactBtn");
  const fullBtn = document.getElementById("densityFullBtn");
  if (compactBtn && fullBtn) {
    compactBtn.classList.toggle("active", Boolean(printPrefs.compactOnePage));
    fullBtn.classList.toggle("active", !printPrefs.compactOnePage);
  }
  const patInput = document.getElementById("printPatientRef");
  if (patInput && patInput.value !== (printPrefs.patientRef || "")) {
    patInput.value = printPrefs.patientRef || "";
  }
  const docInput = document.getElementById("printPhysicianRef");
  if (docInput && docInput.value !== (printPrefs.physicianRef || "")) {
    docInput.value = printPrefs.physicianRef || "";
  }
}

const SYMPTOM_CHIPS = [
  "Lower energy",
  "Pelvic discomfort",
  "Cramps",
  "Sleep changes",
  "Mood changes",
  "Headache",
];
const selectedChips = new Set();

function renderChips() {
  document.getElementById("chipRow").innerHTML = SYMPTOM_CHIPS.map((chip) => {
    const on = selectedChips.has(chip);
    return `<button type="button" class="chip${on ? " selected" : ""}" aria-pressed="${on}" onclick="toggleChip('${chip}')">${escapeHTML(chip)}</button>`;
  }).join("");
}

function toggleChip(chip) {
  selectedChips.has(chip)
    ? selectedChips.delete(chip)
    : selectedChips.add(chip);
  renderChips();
}

// Known label -> slug (e.g. "Lower energy" -> "lower-energy"); anything else -> "other".
function categoryFor(label) {
  const known = SYMPTOM_CHIPS.find(
    (c) => c.toLowerCase() === label.trim().toLowerCase(),
  );
  return known ? known.toLowerCase().replace(/\s+/g, "-") : "other";
}

function readJSON(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    if (Array.isArray(value)) {
      return value.map((item) => ({
        schemaVersion: CURRENT_SCHEMA_VERSION,
        ...item,
      }));
    }
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

let cachedTimelineItems = null;
let cachedPeriodStarts = null;
let cachedCycleIntervals = null;
let cachedAnalysis = null;

function invalidateAppCaches() {
  cachedTimelineItems = null;
  cachedPeriodStarts = null;
  cachedCycleIntervals = null;
  cachedAnalysis = null;
}

function persistEntries() {
  invalidateAppCaches();
  localStorage.setItem(ENTRY_KEY, JSON.stringify(entries));
}

function persistVoiceNotes() {
  localStorage.setItem(VOICE_KEY, JSON.stringify(voiceNotes));
}

function persistMedications() {
  invalidateAppCaches();
  localStorage.setItem(MEDICATIONS_KEY, JSON.stringify(medications));
}

function localISODate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dayNumber(isoDate) {
  if (!isoDate || isoDate.length < 10) return 0;
  return (
    Date.UTC(
      Number(isoDate.slice(0, 4)),
      Number(isoDate.slice(5, 7)) - 1,
      Number(isoDate.slice(8, 10)),
    ) / 86_400_000
  );
}

const DATE_FORMAT_CACHE = new Map();
function formatDate(
  isoDate,
  options = { month: "short", day: "numeric", year: "numeric" },
) {
  if (!isoDate) return "";
  const key = `${isoDate}_${options.month || ""}_${options.day || ""}_${options.year ? "y" : ""}_${options.weekday || ""}`;
  let formatted = DATE_FORMAT_CACHE.get(key);
  if (!formatted) {
    formatted = new Date(`${isoDate}T12:00:00`).toLocaleDateString(
      undefined,
      options,
    );
    DATE_FORMAT_CACHE.set(key, formatted);
  }
  return formatted;
}

const ESCAPE_MAP = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ESCAPE_MAP[ch]);
}

function saveAndRender() {
  persistEntries();
  render();
}

function go(page) {
  document.querySelectorAll(".nav button").forEach((button) => {
    button.classList.toggle("active", button.dataset.page === page);
  });
  document.querySelectorAll(".page").forEach((section) => {
    section.classList.toggle("active", section.id === `page-${page}`);
  });
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (page === "summary") generateSummary();
  if (page === "records") {
    renderRecordNotes();
    renderMedications();
  }
}

document.querySelectorAll(".nav button").forEach((button) => {
  button.addEventListener("click", () => go(button.dataset.page));
});

document.getElementById("todayDate").textContent =
  new Date().toLocaleDateString(undefined, {
    weekday: "short",
    month: "long",
    day: "numeric",
  });

let currentTimelineFilter = "all";

function getAllTimelineItems() {
  if (cachedTimelineItems) return cachedTimelineItems;
  const visibleEntries = entries.filter(
    (entry) => entry.type !== "voice-source",
  );
  const docItems = documents
    .filter((doc) => doc.recordDate && doc.showOnTimeline !== false)
    .map((doc) => ({
      id: "doc-" + doc.id,
      type: "document",
      date: doc.recordDate,
      title: doc.name,
      category: doc.category || "Lab / Medical report",
      detail: doc.keyFinding
        ? `Key finding: ${doc.keyFinding}${doc.notes ? ` · Note: ${doc.notes}` : ""}`
        : doc.notes || "",
      documentId: doc.id,
      fileName: doc.name,
      extractionConfirmed: Boolean(doc.extractionConfirmed),
    }));
  const medItems = medications
    .filter((m) => m.startDate)
    .map((m) => ({
      id: "med-" + m.id,
      type: "medication",
      category: m.category || "medication",
      status: m.status || "active",
      date: m.startDate,
      title: `${m.name}${m.dosage ? ` (${m.dosage})` : ""}`,
      detail: `${m.frequency ? `${m.frequency} · ` : ""}Started ${formatDate(m.startDate)}${m.notes ? ` — ${m.notes}` : ""}`,
      medId: m.id,
      medicationObj: m,
    }));
  cachedTimelineItems = [...visibleEntries, ...docItems, ...medItems].sort(
    (a, b) => b.date.localeCompare(a.date),
  );
  return cachedTimelineItems;
}

function timelineMarkup(list) {
  if (!list.length) {
    return '<p class="empty-state">Nothing to display for this filter.</p>';
  }

  const byDate = new Map();
  list
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date))
    .forEach((entry) => {
      if (!byDate.has(entry.date)) byDate.set(entry.date, []);
      byDate.get(entry.date).push(entry);
    });

  return Array.from(byDate.entries())
    .map(([dateStr, items]) => {
      const hasMarker = items.some((e) => e.type === "context");
      const hasDoc = items.some((e) => e.type === "document");
      const hasMed = items.some((e) => e.type === "medication");

      const eventDotClass = hasDoc
        ? "lab-report"
        : hasMed
          ? "medication-event"
          : hasMarker
            ? "marker"
            : "";
      const formattedDate = formatDate(dateStr, {
        month: "short",
        day: "numeric",
      });
      const year = new Date(`${dateStr}T12:00:00`).getFullYear();

      const itemsHTML = items
        .map((entry) => {
          if (entry.type === "document") {
            const provenanceBadge = entry.extractionConfirmed
              ? `<span class="tag lab-tag">Extracted from report (confirmed by you)</span>`
              : `<span class="tag lab-tag">${escapeHTML(entry.category || "Lab / Report")}</span>`;
            return `<div class="timeline-day-entry lab-entry">
          <div class="timeline-day-entry-main">
            <strong>${escapeHTML(entry.title)}</strong>
            ${entry.detail ? `<span class="timeline-entry-note">${escapeHTML(entry.detail)}</span>` : ""}
          </div>
          <div class="timeline-day-entry-tags">
            ${provenanceBadge}
            <button class="text-button timeline-source" onclick="downloadDocumentById('${entry.documentId}')">Download</button>
            <button class="text-button timeline-source" onclick="go('records')">View in records</button>
          </div>
        </div>`;
          }

          if (entry.type === "medication") {
            const isSupp = entry.category === "supplement";
            const statusClass = entry.status || "active";
            return `<div class="timeline-day-entry medication-entry">
          <div class="timeline-day-entry-main">
            <strong>${escapeHTML(entry.title)}</strong>
            ${entry.detail ? `<span class="timeline-entry-note">${escapeHTML(entry.detail)}</span>` : ""}
          </div>
          <div class="timeline-day-entry-tags">
            <span class="tag ${isSupp ? "supp-tag" : "med-tag"}">${isSupp ? "Supplement" : "Medication"}</span>
            <span class="med-status-pill ${statusClass}" style="font-size:10px">${statusClass}</span>
            <button class="text-button timeline-source" onclick="go('records')">View in records</button>
          </div>
        </div>`;
          }

          if (entry.type === "period") {
            const detailText =
              entry.detail &&
              entry.detail !== "Cycle event" &&
              entry.detail !== "Added from your reviewed voice check-in"
                ? `<span class="timeline-entry-note">${escapeHTML(entry.detail)}</span>`
                : "";
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

          if (entry.type === "context") {
            return `<div class="timeline-day-entry context-entry">
          <div class="timeline-day-entry-main">
            <strong>${escapeHTML(entry.title)}</strong>
            ${entry.detail ? `<span class="timeline-entry-note">${escapeHTML(entry.detail)}</span>` : ""}
          </div>
          <div class="timeline-day-entry-tags">
            <span class="tag green">Context marker</span>
          </div>
        </div>`;
          }

          // Check-in or personal note
          const sourceTag = entry.sourceId
            ? `<button class="text-button timeline-source" onclick="go('records')">View voice note</button>`
            : "";
          const detailText =
            entry.detail &&
            entry.detail !== "Added by you" &&
            entry.detail !== "Added from your reviewed voice check-in" &&
            entry.detail !== "Check-in"
              ? `<span class="timeline-entry-note">${escapeHTML(entry.detail)}</span>`
              : "";

          return `<div class="timeline-day-entry checkin-entry">
        <div class="timeline-day-entry-main">
          <strong>${escapeHTML(entry.title)}</strong>
          ${detailText}
        </div>
        <div class="timeline-day-entry-tags">
          <span class="tag ${entry.type === "record" ? "green" : ""}">Check-in</span>
          ${sourceTag}
        </div>
      </div>`;
        })
        .join("");

      return `<div class="event ${eventDotClass}">
      <div class="event-date">${formattedDate} · ${year}</div>
      <div class="event-text">
        <div class="timeline-day-group">
          ${itemsHTML}
        </div>
      </div>
    </div>`;
    })
    .join("");
}

function filterTimeline(filter) {
  currentTimelineFilter = filter;
  document.querySelectorAll(".timeline-filter-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.filter === filter);
  });
  renderTimelineOnly();
}

function renderTimelineOnly() {
  const allItems = getAllTimelineItems();
  let filtered = allItems;
  if (currentTimelineFilter === "period") {
    filtered = allItems.filter((item) => item.type === "period");
  } else if (currentTimelineFilter === "symptom") {
    filtered = allItems.filter((item) => item.type === "symptom");
  } else if (currentTimelineFilter === "context") {
    filtered = allItems.filter((item) => item.type === "context");
  } else if (currentTimelineFilter === "medication") {
    filtered = allItems.filter((item) => item.type === "medication");
  } else if (currentTimelineFilter === "document") {
    filtered = allItems.filter((item) => item.type === "document");
  }
  const fullEl = document.getElementById("fullTimeline");
  if (fullEl) {
    fullEl.innerHTML = timelineMarkup(filtered);
  }
  const totalEl = document.getElementById("eventTotal");
  if (totalEl) {
    totalEl.textContent = `${filtered.length} ${filtered.length === 1 ? "entry" : "entries"}`;
  }
}

function periodStarts(list = entries) {
  if (list === entries && cachedPeriodStarts) return cachedPeriodStarts;
  const res = list
    .filter(
      (entry) =>
        entry.type === "period" &&
        (entry.periodRole === "start" || entry.title === "Period started"),
    )
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));
  if (list === entries) cachedPeriodStarts = res;
  return res;
}

function cycleIntervals(list = entries) {
  if (list === entries && cachedCycleIntervals) return cachedCycleIntervals;
  const starts = periodStarts(list);
  const res = starts
    .slice(1)
    .map((entry, index) => ({
      days: dayNumber(entry.date) - dayNumber(starts[index].date),
      start: starts[index],
      end: entry,
    }))
    .filter((interval) => interval.days >= 15 && interval.days < 200);
  if (list === entries) cachedCycleIntervals = res;
  return res;
}

function getAnalysis(list = entries) {
  if (list === entries && cachedAnalysis) return cachedAnalysis;
  const res = analyze(list, { today: localISODate(), rules: RULES });
  if (list === entries) cachedAnalysis = res;
  return res;
}

function bleedingDurations(list = entries) {
  const starts = periodStarts(list);
  const ends = list
    .filter(
      (entry) =>
        entry.type === "period" &&
        (entry.periodRole === "end" || entry.title === "Period ended"),
    )
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));
  return starts.flatMap((start, index) => {
    const nextStart = starts[index + 1]?.date;
    const end = ends.find(
      (item) =>
        item.date >= start.date && (!nextStart || item.date < nextStart),
    );
    if (!end) return [];
    const days = dayNumber(end.date) - dayNumber(start.date) + 1;
    return days > 0 && days <= 30 ? [{ days, start, end }] : [];
  });
}

function renderStats() {
  const analysis = getAnalysis();
  const starts = periodStarts();
  const recentIntervals = cycleIntervals().slice(-4);
  const range = analysis.summary
    ? `${analysis.summary.min}–${analysis.summary.max} d`
    : recentIntervals.length
      ? `${Math.min(...recentIntervals.map((item) => item.days))}–${Math.max(...recentIntervals.map((item) => item.days))} d`
      : "—";

  document.getElementById("cycleLengthRange").textContent = range;
  const confText =
    analysis.confidence.charAt(0).toUpperCase() + analysis.confidence.slice(1);
  document.getElementById("cycleRangeCaption").textContent =
    `${confText} confidence · ${analysis.basedOnCycles} cycle${analysis.basedOnCycles === 1 ? "" : "s"}`;
  document.getElementById("periodCount").textContent = starts.length;

  const durations = bleedingDurations().slice(-4);
  const durationRange = durations.length
    ? `${Math.min(...durations.map((item) => item.days))}–${Math.max(...durations.map((item) => item.days))} d`
    : "—";
  document.getElementById("bleedingDuration").textContent = durationRange;
  document.getElementById("bleedingCaption").textContent = durations.length
    ? `${durations.length} date pair${durations.length === 1 ? "" : "s"}`
    : "Need a start + end";

  const thirtyDaysAgo = dayNumber(localISODate()) - 29;
  const recentCheckins = entries.filter(
    (entry) =>
      ["symptom", "context", "record"].includes(entry.type) &&
      dayNumber(entry.date) >= thirtyDaysAgo,
  ).length;
  document.getElementById("checkinCount").textContent = recentCheckins;

  const rangeElement = document.getElementById("latestCycleRange");
  const captionElement = document.getElementById("rangeCaption");
  rangeElement.textContent = range;
  if (analysis.populationComparison) {
    captionElement.textContent = `Calculated from your logs · ${analysis.populationComparison.percentileEstimate} (Bull et al. 2019)`;
  } else {
    captionElement.textContent = recentIntervals.length
      ? "Calculated from the period start dates you logged."
      : "Cycle lengths appear after two period starts.";
  }

  const band = document.querySelector(".range-band");
  const marker = document.querySelector(".range-dot");
  if (recentIntervals.length) {
    const min = Math.min(...recentIntervals.map((item) => item.days));
    const max = Math.max(...recentIntervals.map((item) => item.days));
    const scale = (value) =>
      Math.max(0, Math.min(100, ((value - 20) / 100) * 100));
    band.style.left = `${scale(min)}%`;
    band.style.width = `${Math.max(2, scale(max) - scale(min))}%`;
    marker.style.left = `${scale(recentIntervals.reduce((sum, item) => sum + item.days, 0) / recentIntervals.length)}%`;
  } else {
    band.style.left = "0%";
    band.style.width = "0%";
    marker.style.left = "50%";
  }
}

function renderCycleReadiness() {
  const card = document.getElementById("readinessCard");
  if (!card) return;

  const starts = periodStarts();
  if (!starts.length) {
    document.getElementById("readinessDates").textContent = "—";
    document.getElementById("readinessCycleDay").textContent = "Day —";
    document.getElementById("readinessBadge").textContent =
      "Needs 1 period start";
    document.getElementById("readinessBadge").className =
      "readiness-badge building";
    document.getElementById("readinessSource").textContent =
      "Log your last period start to calculate your next window";
    document.getElementById("readinessTipTitle").textContent =
      "Awaiting your first period start";
    document.getElementById("readinessTipBody").textContent =
      "Once you record a period start date, Cycle Context will map your personal window of possibility.";
    document.getElementById("readinessBand").style.left = "0%";
    document.getElementById("readinessBand").style.width = "0%";
    document.getElementById("readinessMarker").style.left = "0%";
    return;
  }

  const todayStr = localISODate();
  const todayNum = dayNumber(todayStr);
  const lastStart = starts[starts.length - 1];
  const lastStartNum = dayNumber(lastStart.date);
  const cycleDay = Math.max(1, todayNum - lastStartNum + 1);

  // Check if currently bleeding
  const ends = entries
    .filter(
      (e) =>
        e.type === "period" &&
        (e.periodRole === "end" || e.title === "Period ended"),
    )
    .sort((a, b) => a.date.localeCompare(b.date));
  const recentEnd = ends.filter((e) => e.date >= lastStart.date)[0];
  const isBleeding =
    (!recentEnd && cycleDay <= 7) ||
    (recentEnd && todayNum <= dayNumber(recentEnd.date));

  // Cycle interval history
  const intervals = cycleIntervals();
  let minDays, maxDays, avgDays, sourceText;

  if (intervals.length >= 2) {
    const dayVals = intervals.slice(-6).map((i) => i.days);
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
    sourceText =
      "Based on FIGO reference window (24–38 d) until more cycles are logged";
  }

  // Calculate earliest and latest expected dates using UTC millisecond arithmetic
  const earliestDate = new Date((lastStartNum + minDays - 1) * 86_400_000);
  const latestDate = new Date((lastStartNum + maxDays - 1) * 86_400_000);
  const earliestDateStr = localISODate(earliestDate);
  const latestDateStr = localISODate(latestDate);

  const formattedWindow = `${formatDate(earliestDateStr, { month: "short", day: "numeric" })} – ${formatDate(latestDateStr, { month: "short", day: "numeric" })}`;
  document.getElementById("readinessDates").textContent = formattedWindow;
  document.getElementById("readinessCycleDay").textContent = `Day ${cycleDay}`;
  document.getElementById("readinessSource").textContent = sourceText;

  // Status classification & readiness guidance
  let badgeClass, badgeText, tipTitle, tipBody;
  const daysUntilWindow = minDays - cycleDay;

  if (isBleeding) {
    badgeClass = "bleeding";
    badgeText = `Active Menstrual Phase (Day ${cycleDay})`;
    tipTitle = "Menstrual phase in progress";
    tipBody =
      "You are currently in your bleeding phase. Take rest, stay hydrated, and log any pelvic sensations or flow notes.";
  } else if (cycleDay < minDays - 3) {
    badgeClass = "building";
    badgeText = `Cycle Building · ~${daysUntilWindow}d to window`;
    tipTitle = `Window begins in ~${daysUntilWindow} days`;
    tipBody = `Expected window opens ${formatDate(earliestDateStr, { month: "short", day: "numeric" })} (Day ${minDays}). Typical follicular or mid-cycle phase; no extra preparation needed yet.`;
  } else if (cycleDay >= minDays - 3 && cycleDay < minDays) {
    badgeClass = "approaching";
    badgeText = `Approaching window (~${daysUntilWindow}d)`;
    tipTitle = "Preparedness mode";
    tipBody = `Your cycle is nearing your typical start window (${formatDate(earliestDateStr, { month: "short", day: "numeric" })}). Keep supplies with you and watch for early physical signs.`;
  } else if (cycleDay >= minDays && cycleDay <= maxDays) {
    badgeClass = "inside";
    badgeText = `Inside window (Day ${cycleDay} of ${minDays}–${maxDays}d)`;
    tipTitle = "Inside typical start window";
    tipBody = `You are in your normal start zone (${minDays}–${maxDays} days). Bleeding may begin any day; tap "Log period" when it starts.`;
  } else {
    badgeClass = "extended";
    badgeText = `Beyond typical range (Day ${cycleDay})`;
    tipTitle = `Day ${cycleDay} (past your typical ${maxDays}d max)`;
    tipBody =
      cycleDay >= 90
        ? "It has been 90+ days since your last period. FIGO criteria define this as an extended gap worth reviewing with a clinician."
        : `Past your recent ${maxDays}-day upper range. Natural shifts in sleep, stress, or hormones commonly extend intervals. Note how you are feeling in check-ins.`;
  }

  const badgeEl = document.getElementById("readinessBadge");
  badgeEl.className = `readiness-badge ${badgeClass}`;
  badgeEl.textContent = badgeText;

  const tipTitleEl = document.getElementById("readinessTipTitle");
  if (tipTitleEl) tipTitleEl.textContent = tipTitle;
  const tipBodyEl = document.getElementById("readinessTipBody");
  if (tipBodyEl) tipBodyEl.textContent = tipBody;

  // Track Visualizer: scale from 1 to max(cycleDay + 10, maxDays + 15, 50)
  const maxScale = Math.max(cycleDay + 10, maxDays + 15, 50);
  const scalePercent = (val) =>
    Math.max(0, Math.min(100, (val / maxScale) * 100));

  const bandLeft = scalePercent(minDays);
  const bandRight = scalePercent(maxDays);
  const bandWidth = Math.max(2, bandRight - bandLeft);
  const markerLeft = scalePercent(cycleDay);

  document.getElementById("readinessBand").style.left = `${bandLeft}%`;
  document.getElementById("readinessBand").style.width = `${bandWidth}%`;
  document.getElementById("readinessMarker").style.left = `${markerLeft}%`;

  document.getElementById("readinessScaleStart").textContent =
    `Day 1 (${formatDate(lastStart.date, { month: "short", day: "numeric" })})`;
  document.getElementById("readinessScaleWindow").textContent =
    `Window: Day ${minDays}–${maxDays}`;
  document.getElementById("readinessScaleEnd").textContent = `Day ${maxScale}`;
}

function renderCycleChart() {
  const intervals = cycleIntervals().slice(-6);
  const chart = document.getElementById("cycleChart");
  const axis = document.getElementById("cycleChartAxis");
  if (!intervals.length) {
    chart.innerHTML =
      '<p class="empty-state">Log at least two period start dates to see the time between them.</p>';
    axis.textContent = "";
    return;
  }

  const xAt = (index) =>
    intervals.length === 1 ? 300 : 42 + (index * 516) / (intervals.length - 1);
  const dayValues = intervals.map((item) => item.days);
  const minDays = Math.floor(Math.min(20, ...dayValues) / 10) * 10;
  const maxDays = Math.ceil(Math.max(60, ...dayValues) / 10) * 10;
  const yAt = (days) =>
    170 - ((days - minDays) / Math.max(1, maxDays - minDays)) * 136;
  const grid = Array.from({ length: 5 }, (_, index) => {
    const y = 34 + index * 34;
    const label = Math.round(maxDays - ((maxDays - minDays) * index) / 4);
    return `<path d="M0 ${y}H600"/><text x="0" y="${y - 3}" fill="#75807a" stroke="none" font-size="9">${label}</text>`;
  }).join("");
  const points = intervals
    .map((item, index) => `${xAt(index)},${yAt(item.days)}`)
    .join(" ");
  const markers = entries.filter((entry) => entry.type === "context");
  const start = dayNumber(intervals[0].start.date);
  const end = dayNumber(intervals[intervals.length - 1].end.date);
  const contextLines = markers
    .filter(
      (item) => dayNumber(item.date) >= start && dayNumber(item.date) <= end,
    )
    .map((item) => {
      const x =
        42 + ((dayNumber(item.date) - start) / Math.max(1, end - start)) * 516;
      return `<line x1="${x}" y1="18" x2="${x}" y2="174" stroke="#c18b16" stroke-width="1.5" stroke-dasharray="4 4"/>`;
    })
    .join("");
  const circles = intervals
    .map(
      (item, index) =>
        `<circle cx="${xAt(index)}" cy="${yAt(item.days)}" r="5" fill="#075f59" stroke="#fffefa" stroke-width="3"><title>${item.days} days, ending ${formatDate(item.end.date)}</title></circle>`,
    )
    .join("");
  chart.innerHTML = `<svg viewBox="0 0 600 190" preserveAspectRatio="none" role="img" aria-label="Recorded cycle lengths over time">
    <g stroke="#e4e8e1" stroke-width="1" fill="#75807a">${grid}</g>
    ${contextLines}<polyline points="${points}" fill="none" stroke="#075f59" stroke-width="2.5"/>${circles}
  </svg>`;
  axis.innerHTML = intervals
    .map(
      (item) => `<span>${formatDate(item.end.date, { month: "short" })}</span>`,
    )
    .join("");
}

let selectedMarkerId = null;

function selectChangeMarker(id) {
  selectedMarkerId = id;
  renderChangeComparison();
}

function renderChangeComparison() {
  const markers = entries
    .filter((entry) => entry.type === "context")
    .sort((a, b) => b.date.localeCompare(a.date));
  const label = document.getElementById("changeMarkerLabel");
  const target = document.getElementById("changeCompare");
  const selectWrapper = document.getElementById("changeSelectWrapper");

  if (!markers.length) {
    if (label) label.textContent = "Personal markers";
    if (selectWrapper) selectWrapper.innerHTML = "";
    target.innerHTML = `<div class="empty-state" style="padding:24px 0">
      <p style="margin-bottom:12px">No context milestones recorded yet. When you add a medication change, lifestyle shift, or health event, you can explore how your cycle and symptoms shifted before vs after.</p>
      <button class="btn primary" onclick="openLog('context')">＋ Mark a milestone</button>
    </div>`;
    return;
  }

  if (
    !selectedMarkerId ||
    !markers.some((m) => (m.id || `${m.date}-${m.title}`) === selectedMarkerId)
  ) {
    selectedMarkerId =
      markers[0].id || `${markers[0].date}-${markers[0].title}`;
  }

  if (selectWrapper) {
    selectWrapper.innerHTML = `<select onchange="selectChangeMarker(this.value)" aria-label="Select milestone to compare">
      ${markers
        .map((m) => {
          const id = m.id || `${m.date}-${m.title}`;
          const isSel = id === selectedMarkerId;
          return `<option value="${escapeHTML(id)}"${isSel ? " selected" : ""}>${escapeHTML(m.title)} (${formatDate(m.date, { month: "short", day: "numeric", year: "numeric" })})</option>`;
        })
        .join("")}
    </select>`;
  }

  const marker =
    markers.find(
      (m) => (m.id || `${m.date}-${m.title}`) === selectedMarkerId,
    ) || markers[0];
  if (label)
    label.textContent = `${marker.title} · ${formatDate(marker.date, { month: "short", day: "numeric" })}`;

  const intervals = cycleIntervals();
  const beforeIntervals = intervals.filter(
    (item) => item.end.date <= marker.date,
  );
  const afterIntervals = intervals.filter(
    (item) => item.end.date > marker.date,
  );

  const calcIntervalStats = (list) => {
    if (!list.length) return null;
    const days = list.map((i) => i.days);
    const min = Math.min(...days);
    const max = Math.max(...days);
    const mean = Math.round(days.reduce((a, b) => a + b, 0) / days.length);
    const spread = max - min;
    const rangeStr = min === max ? `${min} days` : `${min}–${max} days`;
    return { count: list.length, min, max, mean, spread, rangeStr };
  };

  const beforeCycle = calcIntervalStats(beforeIntervals);
  const afterCycle = calcIntervalStats(afterIntervals);

  let cycleDeltaSummary =
    "Record at least 1 cycle interval on each side to view change metrics";
  let cycleDeltaClass = "neutral";
  if (beforeCycle && afterCycle) {
    const diff = afterCycle.mean - beforeCycle.mean;
    const spreadDiff = afterCycle.spread - beforeCycle.spread;
    const diffText =
      diff === 0
        ? "Same average length"
        : `${diff > 0 ? `+${diff}` : diff} days average length`;
    const spreadText =
      spreadDiff === 0
        ? "unchanged spread"
        : `spread ${spreadDiff < 0 ? `reduced by ${Math.abs(spreadDiff)}d` : `widened by ${spreadDiff}d`}`;
    cycleDeltaSummary = `${diffText} · Variation ${spreadText}`;
    cycleDeltaClass = spreadDiff <= 0 ? "positive" : "neutral";
  }

  const durations = bleedingDurations();
  const beforeDurations = durations.filter((d) => d.end.date <= marker.date);
  const afterDurations = durations.filter((d) => d.end.date > marker.date);

  const calcBleedStats = (list) => {
    if (!list.length) return null;
    const days = list.map((d) => d.days);
    const min = Math.min(...days);
    const max = Math.max(...days);
    const mean = (days.reduce((a, b) => a + b, 0) / days.length).toFixed(1);
    const rangeStr = min === max ? `${min} days` : `${min}–${max} days`;
    return { count: list.length, min, max, mean, rangeStr };
  };

  const beforeBleed = calcBleedStats(beforeDurations);
  const afterBleed = calcBleedStats(afterDurations);

  let bleedDeltaSummary = "Add start + end dates to compare bleeding duration";
  let bleedDeltaClass = "neutral";
  if (beforeBleed && afterBleed) {
    const diff = (
      parseFloat(afterBleed.mean) - parseFloat(beforeBleed.mean)
    ).toFixed(1);
    const diffText =
      diff === "0.0"
        ? "Unchanged bleeding duration"
        : `${diff > 0 ? `+${diff}` : diff} days average bleeding`;
    bleedDeltaSummary = diffText;
    bleedDeltaClass = parseFloat(diff) <= 0 ? "positive" : "neutral";
  }

  const symptomEntries = entries.filter((e) => e.type === "symptom");
  const symptomsMap = new Map();
  symptomEntries.forEach((entry) => {
    const name = entry.title.trim();
    if (!name) return;
    const key = name.toLowerCase();
    const curr = symptomsMap.get(key) || { name, before: 0, after: 0 };
    if (entry.date <= marker.date) curr.before += 1;
    else curr.after += 1;
    symptomsMap.set(key, curr);
  });

  const symptomRows = [...symptomsMap.values()].sort(
    (a, b) => b.before + b.after - (a.before + a.after),
  );

  const symptomsHTML = symptomRows.length
    ? `
    <div class="symptom-shift-grid">
      ${symptomRows
        .map(
          (s) => `
        <div class="symptom-shift-badge">
          <span>${escapeHTML(s.name)}</span>
          <div class="symptom-shift-counts">
            <span class="shift-before">${s.before}× before</span>
            <span class="shift-arrow">→</span>
            <span class="shift-after">${s.after}× after</span>
          </div>
        </div>
      `,
        )
        .join("")}
    </div>
  `
    : '<p class="empty-state" style="margin:8px 0 0">No symptoms recorded in check-ins around this period.</p>';

  target.innerHTML = `
    <div class="marker-pill-banner">
      <div class="marker-pill-info">
        <span class="tag amber">Milestone</span>
        <strong>${escapeHTML(marker.title)}</strong>
        <span class="marker-date">${formatDate(marker.date, { month: "short", day: "numeric", year: "numeric" })}</span>
      </div>
      <div class="marker-detail-note">${escapeHTML(marker.detail || "Context recorded by you")}</div>
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
              <span class="col-tag">Before (${beforeCycle ? `${beforeCycle.count} cycle${beforeCycle.count === 1 ? "" : "s"}` : "0 cycles"})</span>
              <div class="col-value">${beforeCycle ? beforeCycle.rangeStr : "—"}</div>
              <small class="col-sub">${beforeCycle ? `Avg: ${beforeCycle.mean}d · Spread: ±${beforeCycle.spread}d` : "No intervals recorded"}</small>
            </div>
            <div class="split-col after">
              <span class="col-tag">After (${afterCycle ? `${afterCycle.count} cycle${afterCycle.count === 1 ? "" : "s"}` : "0 cycles"})</span>
              <div class="col-value">${afterCycle ? afterCycle.rangeStr : "—"}</div>
              <small class="col-sub">${afterCycle ? `Avg: ${afterCycle.mean}d · Spread: ±${afterCycle.spread}d` : "No intervals recorded"}</small>
            </div>
          </div>
        </div>
        <div class="stat-delta ${cycleDeltaClass}">
          <span>•</span> ${cycleDeltaSummary}
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
              <span class="col-tag">Before (${beforeBleed ? `${beforeBleed.count} period${beforeBleed.count === 1 ? "" : "s"}` : "0 periods"})</span>
              <div class="col-value">${beforeBleed ? beforeBleed.rangeStr : "—"}</div>
              <small class="col-sub">${beforeBleed ? `Avg: ${beforeBleed.mean} days` : "No start/end pairs"}</small>
            </div>
            <div class="split-col after">
              <span class="col-tag">After (${afterBleed ? `${afterBleed.count} period${afterBleed.count === 1 ? "" : "s"}` : "0 periods"})</span>
              <div class="col-value">${afterBleed ? afterBleed.rangeStr : "—"}</div>
              <small class="col-sub">${afterBleed ? `Avg: ${afterBleed.mean} days` : "No start/end pairs"}</small>
            </div>
          </div>
        </div>
        <div class="stat-delta ${bleedDeltaClass}">
          <span>•</span> ${bleedDeltaSummary}
        </div>
      </div>
    </div>

    <div class="explorer-symptoms-section">
      <div class="stat-header" style="margin-bottom:0">
        <span class="stat-icon">◈</span>
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

function renderPopulationComparison() {
  const container = document.getElementById("populationCompare");
  const badge = document.getElementById("populationBadge");
  if (!container) return;

  const analysis = getAnalysis();
  const popComp = analysis.populationComparison;

  if (!popComp) {
    if (badge) {
      badge.textContent = "Need 2+ starts";
      badge.className = "population-badge";
    }
    container.innerHTML = `
      <div class="pop-insight-box">
        <p style="margin:0;color:var(--muted)">Log at least two period start dates to compare your personal cycle distribution with published population research (Bull et al. 2019, n=612,613 cycles).</p>
      </div>
    `;
    return;
  }

  // Set badge style & label
  if (badge) {
    if (popComp.band === "middle50") {
      badge.textContent = "Middle 50% (27–31d)";
      badge.className = "population-badge middle50";
    } else if (popComp.band === "shorter-50" || popComp.band === "longer-50") {
      badge.textContent =
        popComp.band === "longer-50"
          ? "75th–95th percentile"
          : "5th–25th percentile";
      badge.className = "population-badge middle90";
    } else {
      badge.textContent =
        popComp.band === "longer-90"
          ? ">95th percentile (>38d)"
          : "<5th percentile (<23d)";
      badge.className = "population-badge outer";
    }
  }

  // Distribution density bars calculation (scale 20 to 42 days)
  const minScale = 20;
  const maxScale = 42;
  const scale = (val) =>
    Math.max(
      0,
      Math.min(100, ((val - minScale) / (maxScale - minScale)) * 100),
    );

  const densityBarsHTML = popComp.distribution
    .map((item) => {
      const is50 =
        item.length >= popComp.middle50.min &&
        item.length <= popComp.middle50.max;
      const isUser =
        item.length >= popComp.userMin && item.length <= popComp.userMax;
      const heightPct = Math.round((item.percent / 16) * 100);
      const classes = ["pop-density-bar"];
      if (is50) classes.push("in-50");
      if (isUser) classes.push("user-active");
      return `<div class="${classes.join(" ")}" style="height:${heightPct}%" title="${item.length} days: ${item.percent}% of cycles in study"></div>`;
    })
    .join("");

  const band90Left = scale(popComp.middle90.min);
  const band90Width = scale(popComp.middle90.max) - band90Left;

  const band50Left = scale(popComp.middle50.min);
  const band50Width = scale(popComp.middle50.max) - band50Left;

  const medianPos = scale(popComp.populationMedian);

  const userBandLeft = scale(popComp.userMin);
  const userBandWidth = Math.max(2, scale(popComp.userMax) - userBandLeft);
  const userMedianPos = scale(popComp.userMedian);

  const varContextHTML = popComp.variationComparison
    ? `
    <div style="display:flex;align-items:center;gap:8px;padding-top:4px;border-top:1px dashed var(--line);margin-top:8px">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--plum);flex-shrink:0"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
      <span style="font-size:12px;color:var(--ink)"><strong>Within-person variation:</strong> ${escapeHTML(popComp.variationComparison.message)}</span>
    </div>
  `
    : "";

  container.innerHTML = `
    <div class="population-stats-row">
      <div class="pop-stat-item">
        <span class="pop-stat-label">Your Median</span>
        <div class="pop-stat-val">${popComp.userMedian} <small style="font-size:13px;font-weight:400">days</small></div>
        <span class="pop-stat-sub">Range: ${popComp.userMin}–${popComp.userMax} d (n=${analysis.basedOnCycles})</span>
      </div>
      <div class="pop-stat-item">
        <span class="pop-stat-label">Study Median</span>
        <div class="pop-stat-val">${popComp.populationMedian} <small style="font-size:13px;font-weight:400">days</small></div>
        <span class="pop-stat-sub">Bull et al. 2019</span>
      </div>
      <div class="pop-stat-item">
        <span class="pop-stat-label">Middle 50% (IQR)</span>
        <div class="pop-stat-val">${popComp.middle50.min}–${popComp.middle50.max} <small style="font-size:13px;font-weight:400">days</small></div>
        <span class="pop-stat-sub">25th to 75th percentile</span>
      </div>
      <div class="pop-stat-item">
        <span class="pop-stat-label">Middle 90%</span>
        <div class="pop-stat-val">${popComp.middle90.min}–${popComp.middle90.max} <small style="font-size:13px;font-weight:400">days</small></div>
        <span class="pop-stat-sub">5th to 95th percentile</span>
      </div>
    </div>

    <div class="pop-dist-container">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px">
        <strong style="font-size:12px;color:var(--ink)">Population Distribution &amp; Your Recorded Cycles</strong>
        <span style="font-size:11px;color:var(--muted)">Scale: 20 to 42+ days</span>
      </div>

      <div class="pop-dist-track-outer">
        <div class="pop-density-histogram">
          ${densityBarsHTML}
        </div>
        <div class="pop-range-track">
          <div class="pop-band-90" style="left:${band90Left}%;width:${band90Width}%" title="Middle 90% (23–38 days)"></div>
          <div class="pop-band-50" style="left:${band50Left}%;width:${band50Width}%" title="Middle 50% (27–31 days)"></div>
          <div class="pop-median-mark" style="left:${medianPos}%" title="Population Median: 29.0 days"></div>

          <!-- User overlay -->
          <div class="pop-user-span" style="left:${userBandLeft}%;width:${userBandWidth}%" title="Your recorded cycle span: ${popComp.userMin}–${popComp.userMax} days"></div>
          <div class="pop-user-pin" style="left:${userMedianPos}%" title="Your cycle median: ${popComp.userMedian} days"></div>
        </div>
      </div>

      <div class="pop-axis-row">
        <span>20d</span>
        <span>24d</span>
        <span>29d (Median)</span>
        <span>34d</span>
        <span>38d</span>
        <span>42d+</span>
      </div>

      <div class="pop-legend">
        <div class="pop-legend-item"><span class="pop-legend-swatch band50"></span><span>Middle 50% of population (27–31d)</span></div>
        <div class="pop-legend-item"><span class="pop-legend-swatch band90"></span><span>Middle 90% of population (23–38d)</span></div>
        <div class="pop-legend-item"><span class="pop-legend-swatch median-line"></span><span>Population median (29.0d)</span></div>
        <div class="pop-legend-item"><span class="pop-legend-swatch user-range"></span><span>Your logged span (${popComp.userMin}–${popComp.userMax}d)</span></div>
        <div class="pop-legend-item"><span class="pop-legend-swatch user-pin"></span><span>Your median (${popComp.userMedian}d)</span></div>
      </div>
    </div>

    <div class="pop-insight-box">
      <div>
        <strong>Where your cycles land:</strong> ${escapeHTML(popComp.bandLabel)}. ${escapeHTML(popComp.narrative)}
      </div>
      ${varContextHTML}
      <div style="font-size:10px;color:var(--muted);margin-top:4px">
        ${escapeHTML(popComp.note)} Data source: ${escapeHTML(popComp.source)}.
      </div>
    </div>
  `;
}

let currentSymptomView = "recurrence";
let currentSymptomPhaseFilter = "all";

function setSymptomPhaseFilter(phase) {
  currentSymptomPhaseFilter = phase;
  const buttons = document.querySelectorAll(
    "#symptomPhaseFilterBar .filter-chip",
  );
  buttons.forEach((btn) =>
    btn.classList.toggle("active", btn.dataset.phase === phase),
  );
  renderSymptomPatterns();
}

function switchSymptomView(mode) {
  currentSymptomView = mode;
  const tabRecurrence = document.getElementById("symTabRecurrence");
  const tabTiming = document.getElementById("symTabTiming");
  const tabCounts = document.getElementById("symTabCounts");
  const filterBar = document.getElementById("symptomPhaseFilterBar");

  if (tabRecurrence)
    tabRecurrence.classList.toggle("active", mode === "recurrence");
  if (tabTiming) tabTiming.classList.toggle("active", mode === "timing");
  if (tabCounts) tabCounts.classList.toggle("active", mode === "counts");
  if (filterBar)
    filterBar.style.display = mode === "recurrence" ? "flex" : "none";

  renderSymptomPatterns();
}

function renderSymptomPatterns() {
  const target = document.getElementById("symptomPatterns");
  if (!target) return;

  const symptomEntries = entries.filter((entry) => entry.type === "symptom");
  if (!symptomEntries.length) {
    target.innerHTML =
      '<p class="empty-state">Symptoms mentioned in check-ins will appear here with cycle phase analysis.</p>';
    return;
  }

  const starts = periodStarts();
  const startsDates = starts.map((s) => s.date);
  const intervals = cycleIntervals();
  const averageCycle = intervals.length
    ? Math.round(intervals.reduce((a, b) => a + b.days, 0) / intervals.length)
    : 30;

  if (currentSymptomView === "recurrence") {
    const correlationData = analyzeSymptomCorrelations(entries);
    const filteredCorrelations = filterCorrelations(
      correlationData.correlations,
      currentSymptomPhaseFilter,
    );

    if (!filteredCorrelations.length) {
      target.innerHTML =
        '<p class="empty-state">No recorded symptoms match this phase filter.</p>';
      return;
    }

    const summaryBarHTML = `
      <div class="symptom-correlation-summary-bar">
        <div class="symptom-correlation-stats">
          <span class="symptom-correlation-stat-item"><strong>${correlationData.totalCyclesObserved}</strong> cycle${correlationData.totalCyclesObserved === 1 ? "" : "s"} tracked</span>
          <span class="symptom-correlation-stat-item"><strong>${correlationData.correlations.length}</strong> unique symptom${correlationData.correlations.length === 1 ? "" : "s"}</span>
          <span class="symptom-correlation-stat-item"><strong>${correlationData.correlations.filter((c) => c.isConsistentRecurrence).length}</strong> consistent phase pattern${correlationData.correlations.filter((c) => c.isConsistentRecurrence).length === 1 ? "" : "s"}</span>
        </div>
        <span class="sample-size-pill">≥3 cycles for high confidence</span>
      </div>
    `;

    const cardsHTML = filteredCorrelations
      .map((item) => {
        const recBadgeClass =
          item.cycleRecurrenceRate >= 60
            ? "high"
            : item.cycleRecurrenceRate >= 40
              ? "moderate"
              : "low";
        const dominantSlug = item.dominantPhase?.slug || "unlinked";
        const dominantShort = item.dominantPhase?.shortName || "Unlinked";

        const totalOccurrences = item.totalOccurrences || 1;
        const distSegmentsHTML = item.phaseBreakdown
          .map((p) => {
            const pct = Math.max(
              5,
              Math.round((p.occurrences / totalOccurrences) * 100),
            );
            return `<div class="phase-dist-segment ${p.slug}" style="width:${pct}%" title="${escapeHTML(p.name)}: ${p.occurrences}x (${pct}%)"></div>`;
          })
          .join("");

        const matrixCellsHTML = startsDates
          .map((dateStr, idx) => {
            const infos = item.phaseInfos.filter((p) => p.cycleIndex === idx);
            const isPresent = infos.length > 0;
            const phaseNames = [...new Set(infos.map((p) => p.phaseSlug))].join(
              ", ",
            );
            return `
          <div class="cycle-matrix-chip ${isPresent ? "active" : ""}" title="Cycle ${idx + 1} (${formatDate(dateStr)}): ${isPresent ? phaseNames : "Not logged"}">
            ${isPresent ? '<span class="dot"></span>' : ""} Cycle ${idx + 1}
          </div>
        `;
          })
          .join("");

        const entriesBullets = item.entries
          .map((e, idx) => {
            const p = item.phaseInfos[idx];
            const cycleLabel = p.cycleDay
              ? `Cycle Day ${p.cycleDay}`
              : "Unlinked";
            const preLabel =
              p.daysBeforeNext !== null
                ? `(${p.daysBeforeNext}d before next period)`
                : "";
            return `<div class="symptom-entry-bullet">
          <span><strong>${formatDate(e.date)}</strong>: ${cycleLabel} ${preLabel} <span class="phase-pill ${p.phaseSlug}" style="font-size:9px;padding:1px 5px;margin-left:4px">${p.phaseSlug}</span></span>
          <span style="font-style:italic">${escapeHTML(e.detail && e.detail !== "Added by you" ? e.detail : "")}</span>
        </div>`;
          })
          .join("");

        return `
        <div class="symptom-recurrence-card">
          <div class="symptom-recurrence-top">
            <div class="symptom-recurrence-title">
              <span>${escapeHTML(item.name)}</span>
              <span class="tag plum" style="font-size:11px">${item.totalOccurrences}×</span>
              <span class="recurrence-badge ${recBadgeClass}">${item.cycleRecurrenceRate}% recurrence</span>
            </div>
            <div style="display:flex;align-items:center;gap:6px">
              <span class="sample-size-pill">${item.cyclesWithSymptom} of ${item.totalCyclesObserved} cycles</span>
              <span class="phase-pill ${dominantSlug}">${escapeHTML(dominantShort)}</span>
            </div>
          </div>

          <div class="symptom-clinical-summary">
            ${escapeHTML(item.clinicalSummary)}
          </div>

          <div class="phase-dist-container">
            <div class="phase-dist-label-row">
              <span>Cycle phase distribution</span>
              <span>${item.totalOccurrences} total entries</span>
            </div>
            <div class="phase-distribution-bar">
              ${distSegmentsHTML}
            </div>
            <div class="phase-legend-row">
              ${item.phaseBreakdown
                .map(
                  (p) => `
                <span class="phase-legend-item">
                  <span class="phase-legend-dot ${p.slug}"></span>
                  <span>${escapeHTML(p.shortName)}: <strong>${p.occurrences}×</strong> (${p.cyclesInPhase} cycle${p.cyclesInPhase === 1 ? "" : "s"})</span>
                </span>
              `,
                )
                .join("")}
            </div>
          </div>

          <div class="cycle-matrix-strip">
            <span class="cycle-matrix-label">Cycles observed:</span>
            ${matrixCellsHTML}
          </div>

          <div class="symptom-entries-dropdown">
            ${entriesBullets}
          </div>
        </div>
      `;
      })
      .join("");

    target.innerHTML = `
      <div class="symptom-recurrence-list">
        ${summaryBarHTML}
        ${cardsHTML}
      </div>
    `;
    return;
  }

  if (currentSymptomView === "counts") {
    const grouped = new Map();
    symptomEntries.forEach((entry) => {
      const name = entry.title.trim();
      if (!name) return;
      const key = name.toLowerCase();
      const curr = grouped.get(key) || { name, count: 0 };
      curr.count += 1;
      grouped.set(key, curr);
    });
    const items = [...grouped.values()].sort((a, b) => b.count - a.count);
    target.innerHTML = items
      .map(
        ({ name, count }) => `
      <div class="report-row">
        <div>
          <strong>${escapeHTML(name)}</strong>
          <small>Logged ${count} time${count === 1 ? "" : "s"}</small>
        </div>
        <span class="tag plum">${count}</span>
      </div>
    `,
      )
      .join("");
    return;
  }

  // Linear cycle track view ('timing')
  const bleeds = bleedingDurations();
  const grouped = new Map();
  symptomEntries.forEach((entry) => {
    const name = entry.title.trim();
    if (!name) return;
    const key = name.toLowerCase();
    const timing = determineEntryPhase(
      entry.date,
      startsDates,
      bleeds,
      averageCycle,
    );
    const item = grouped.get(key) || {
      name,
      count: 0,
      timings: [],
      entries: [],
    };
    item.count += 1;
    item.timings.push(timing);
    item.entries.push(entry);
    grouped.set(key, item);
  });

  const items = [...grouped.values()].sort((a, b) => b.count - a.count);

  target.innerHTML = `
    <div class="symptom-timing-list">
      ${items
        .map(({ name, count, timings, entries: itemEntries }) => {
          const phaseCounts = new Map();
          timings.forEach((t) =>
            phaseCounts.set(
              t.phaseSlug,
              (phaseCounts.get(t.phaseSlug) || 0) + 1,
            ),
          );
          const [topPhaseSlug, topPhaseCount] = [...phaseCounts.entries()].sort(
            (a, b) => b[1] - a[1],
          )[0] || ["unlinked", 0];
          const dominantTiming =
            timings.find((t) => t.phaseSlug === topPhaseSlug) || timings[0];
          const percentInPhase = Math.round((topPhaseCount / count) * 100);

          const markersHTML = timings
            .map(
              (t) =>
                `<div class="cycle-track-marker" style="left:${t.percentage}%" title="${escapeHTML(name)}: Day ${t.cycleDay || "?"} (${t.phaseName})"></div>`,
            )
            .join("");

          const entriesBullets = itemEntries
            .map((e, idx) => {
              const t = timings[idx];
              const cycleLabel = t.cycleDay
                ? `Cycle Day ${t.cycleDay}`
                : "Unlinked";
              const preLabel =
                t.daysBeforeNext !== null
                  ? `(${t.daysBeforeNext}d before next period)`
                  : "";
              return `<div class="symptom-entry-bullet">
            <span><strong>${formatDate(e.date)}</strong>: ${cycleLabel} ${preLabel}</span>
            <span style="font-style:italic">${escapeHTML(e.detail && e.detail !== "Added by you" ? e.detail : "")}</span>
          </div>`;
            })
            .join("");

          return `
          <div class="symptom-timing-item">
            <div class="symptom-timing-top">
              <div class="symptom-timing-name">
                ${escapeHTML(name)}
                <span class="tag plum" style="font-size:11px">${count}×</span>
              </div>
              <div class="symptom-timing-meta">
                <span class="phase-pill ${topPhaseSlug}">${dominantTiming.phaseName.split("(")[0].trim()}</span>
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
        })
        .join("")}
    </div>
  `;
}

function renderInsight() {
  const analysis = getAnalysis();
  const target = document.getElementById("summaryInsight");
  if (analysis.flags.length) {
    const flag = analysis.flags[0];
    target.innerHTML = `<div class="insight-tag">Pattern to discuss</div>
      <p style="font-weight:600;margin:6px 0 4px;color:var(--ink)">${escapeHTML(flag.title)}</p>
      <p style="font-size:12px;line-height:1.55;color:#414a42;margin:0 0 8px">${escapeHTML(flag.message)}</p>
      <div class="source-line" style="font-size:10px;color:var(--muted)">Reference: ${escapeHTML(flag.rule?.source || "FIGO 2018 criteria")} · These reference ranges haven't been clinically reviewed yet.</div>`;
    return;
  }

  const grouped = new Map();
  entries
    .filter((entry) => entry.type === "symptom")
    .forEach((entry) =>
      grouped.set(entry.title, (grouped.get(entry.title) || 0) + 1),
    );
  const top = [...grouped.entries()].sort((a, b) => b[1] - a[1])[0];
  target.innerHTML = top
    ? `<div class="insight-tag">From your entries</div><p>You’ve logged <b>${escapeHTML(top[0].toLowerCase())}</b> ${top[1]} time${top[1] === 1 ? "" : "s"}.</p><div class="source-line">A count of your own check-ins; no cause is inferred.</div>`
    : '<div class="insight-tag">From your entries</div><p>Add a voice check-in or cycle detail to start building your personal history.</p>';
}

function renderRecordNotes() {
  const target = document.getElementById("recordNotes");
  const manualNotes = entries
    .filter((entry) => entry.type === "record")
    .sort((a, b) => b.date.localeCompare(a.date));
  const notes = [
    ...manualNotes.map((entry) => ({
      date: entry.date,
      title: entry.title,
      detail: entry.detail,
      kind: "note",
    })),
    ...voiceNotes.map((note) => ({
      date: note.date,
      title: "Voice check-in",
      detail: note.text,
      kind: "voice",
    })),
  ].sort((a, b) => b.date.localeCompare(a.date));

  target.innerHTML = notes.length
    ? notes
        .map(
          (
            note,
          ) => `<article class="record-note ${note.kind === "voice" ? "voice-record" : ""}">
    <div class="record-note-top"><strong>${escapeHTML(note.title)}</strong><span class="tag ${note.kind === "voice" ? "plum" : "green"}">${note.kind === "voice" ? "Original transcript" : "Added by you"}</span></div>
    <small>${formatDate(note.date)}</small><p>${escapeHTML(note.detail || "")}</p></article>`,
        )
        .join("")
    : '<p class="empty-state">Your saved notes and reviewed voice check-ins will appear here.</p>';
}

function renderMedications() {
  const container = document.getElementById("medicationsList");
  const countEl = document.getElementById("medicationCount");
  if (!container) return;

  renderMedicationPresets();

  const activeMeds = medications.filter(
    (m) => (m.status || "active") === "active",
  );
  if (countEl) {
    countEl.textContent = `${activeMeds.length} active · ${medications.length} total`;
  }

  if (!medications.length) {
    container.innerHTML = `<div class="empty-state" style="grid-column:1/-1;padding:24px 0">
      <p style="margin-bottom:12px">No medications or supplements logged yet. Keep your daily prescriptions, vitamins, and dosages in one private list.</p>
      <button class="btn primary" onclick="openMedicationModal()">＋ Add your first regimen</button>
    </div>`;
    return;
  }

  const sortedMeds = medications.slice().sort((a, b) => {
    const aActive = (a.status || "active") === "active" ? 1 : 0;
    const bActive = (b.status || "active") === "active" ? 1 : 0;
    if (aActive !== bActive) return bActive - aActive;
    return (b.startDate || "").localeCompare(a.startDate || "");
  });

  container.innerHTML = sortedMeds
    .map((m) => {
      const duration = calculateRegimenDuration(
        m.startDate,
        m.endDate,
        localISODate(),
      );
      const status = m.status || "active";
      const isIncluded = m.includeInSummary !== false;
      const dateRangeStr = m.endDate
        ? `${formatDate(m.startDate)} – ${formatDate(m.endDate)}`
        : `Since ${formatDate(m.startDate)}`;

      return `
      <div class="med-item-card ${status}">
        <div class="med-item-head">
          <div class="med-title-group">
            <span class="med-name">${escapeHTML(m.name)}</span>
            <span class="med-category-pill ${m.category || "medication"}">${escapeHTML(m.category || "medication")}</span>
          </div>
          <span class="med-status-pill ${status}">${status}</span>
        </div>
        <div class="med-details">
          <div class="med-dosage-line">${escapeHTML(m.dosage || "Standard dose")}${m.frequency ? ` · ${escapeHTML(m.frequency)}` : ""}</div>
          <div class="med-timing-line">${dateRangeStr}</div>
          <div class="med-duration-line">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            ${duration.durationText}
          </div>
          ${m.notes ? `<div class="med-notes-line">${escapeHTML(m.notes)}</div>` : ""}
        </div>
        <div class="med-item-foot">
          <label class="med-summary-toggle" title="Include in Clinician Consultation Brief">
            <input type="checkbox" ${isIncluded ? "checked" : ""} onchange="toggleMedicationSummaryInclusion('${m.id}')">
            <span>In visit brief</span>
          </label>
          <div class="med-actions-group">
            <button class="med-action-btn" onclick="toggleMedicationStatus('${m.id}')" title="Change active/pause/complete status">
              ${status === "active" ? "Pause" : status === "paused" ? "Resume" : "Reactivate"}
            </button>
            <button class="med-action-btn" onclick="openMedicationModal('${m.id}')">Edit</button>
            <button class="med-action-btn danger" onclick="deleteMedication('${m.id}')" title="Delete regimen">Delete</button>
          </div>
        </div>
      </div>
    `;
    })
    .join("");
}

function renderMedicationPresets() {
  const container = document.getElementById("medPresetChips");
  if (!container) return;

  container.innerHTML = COMMON_MEDICATION_PRESETS.map(
    (p) => `
    <button type="button" class="med-preset-chip" onclick="applyMedPreset('${escapeHTML(p.name)}')">
      ＋ ${escapeHTML(p.name)}
    </button>
  `,
  ).join("");
}

function applyMedPreset(presetName) {
  const preset = COMMON_MEDICATION_PRESETS.find((p) => p.name === presetName);
  if (!preset) return;
  openMedicationModal(null, preset);
}

function openMedicationModal(medId = null, preset = null) {
  currentEditingMedId = medId;
  const modal = document.getElementById("medicationModalBackdrop");
  const titleEl = document.getElementById("medicationModalTitle");
  const nameEl = document.getElementById("medName");
  const catEl = document.getElementById("medCategory");
  const statusEl = document.getElementById("medStatus");
  const dosageEl = document.getElementById("medDosage");
  const freqEl = document.getElementById("medFrequency");
  const startEl = document.getElementById("medStartDate");
  const endEl = document.getElementById("medEndDate");
  const notesEl = document.getElementById("medNotes");
  const contextCheck = document.getElementById("medCreateContextMarker");
  const summaryCheck = document.getElementById("medIncludeInSummary");

  if (medId) {
    const med = medications.find((m) => m.id === medId);
    if (!med) return;
    titleEl.textContent = "Edit Medication / Supplement";
    nameEl.value = med.name || "";
    catEl.value = med.category || "medication";
    statusEl.value = med.status || "active";
    dosageEl.value = med.dosage || "";
    freqEl.value = med.frequency || "";
    startEl.value = med.startDate || localISODate();
    endEl.value = med.endDate || "";
    notesEl.value = med.notes || "";
    contextCheck.checked = false;
    summaryCheck.checked = med.includeInSummary !== false;
  } else if (preset) {
    titleEl.textContent = `Add ${preset.name}`;
    nameEl.value = preset.name;
    catEl.value = preset.category || "medication";
    statusEl.value = "active";
    dosageEl.value = preset.defaultDosage || "";
    freqEl.value = preset.defaultFrequency || "";
    startEl.value = localISODate();
    endEl.value = "";
    notesEl.value = preset.notes || "";
    contextCheck.checked = true;
    summaryCheck.checked = true;
  } else {
    titleEl.textContent = "Add Medication / Supplement";
    nameEl.value = "";
    catEl.value = "medication";
    statusEl.value = "active";
    dosageEl.value = "";
    freqEl.value = "Once daily";
    startEl.value = localISODate();
    endEl.value = "";
    notesEl.value = "";
    contextCheck.checked = true;
    summaryCheck.checked = true;
  }

  handleMedStatusChange(statusEl.value);
  modal.classList.add("show");
}

function closeMedicationModal() {
  document.getElementById("medicationModalBackdrop").classList.remove("show");
  currentEditingMedId = null;
}

function handleMedStatusChange(status) {
  const endInput = document.getElementById("medEndDate");
  if (status === "completed" && endInput && !endInput.value) {
    endInput.value = localISODate();
  }
}

function saveMedication() {
  const name = document.getElementById("medName").value.trim();
  const category = document.getElementById("medCategory").value;
  const status = document.getElementById("medStatus").value;
  const dosage = document.getElementById("medDosage").value.trim();
  const frequency = document.getElementById("medFrequency").value.trim();
  const startDate =
    document.getElementById("medStartDate").value || localISODate();
  const endDate = document.getElementById("medEndDate").value.trim() || null;
  const notes = document.getElementById("medNotes").value.trim();
  const createContextMarker = document.getElementById(
    "medCreateContextMarker",
  ).checked;
  const includeInSummary = document.getElementById(
    "medIncludeInSummary",
  ).checked;

  if (!name) {
    alert("Please enter a medication or supplement name.");
    return;
  }

  if (currentEditingMedId) {
    const idx = medications.findIndex((m) => m.id === currentEditingMedId);
    if (idx !== -1) {
      medications[idx] = {
        ...medications[idx],
        name,
        category,
        status,
        dosage,
        frequency,
        startDate,
        endDate,
        notes,
        includeInSummary,
        updatedAt: new Date().toISOString(),
      };
    }
  } else {
    const newMed = {
      id: "med-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6),
      name,
      category,
      status,
      dosage,
      frequency,
      startDate,
      endDate,
      notes,
      includeInSummary,
      createdAt: new Date().toISOString(),
    };
    medications.unshift(newMed);

    if (createContextMarker) {
      const milestoneTitle = `${category === "medication" ? "Medication" : "Supplement"} started: ${name}${dosage ? ` (${dosage})` : ""}`;
      const existingEntry = entries.find(
        (e) => e.date === startDate && e.title === milestoneTitle,
      );
      if (!existingEntry) {
        entries.unshift({
          schemaVersion: CURRENT_SCHEMA_VERSION,
          date: startDate,
          type: "context",
          title: milestoneTitle,
          detail:
            notes ||
            (frequency
              ? `Dose: ${dosage || "standard"} · ${frequency}`
              : "Logged with medication tracker"),
        });
        persistEntries();
      }
    }
  }

  persistMedications();
  closeMedicationModal();
  saveAndRender();
  renderMedications();
  renderClinicianBrief();
  toast(
    currentEditingMedId ? "Regimen updated" : "Regimen saved to your records",
  );
}

function deleteMedication(id) {
  const med = medications.find((m) => m.id === id);
  if (!med) return;
  if (!confirm(`Delete ${med.name} from your medications list?`)) return;

  medications = medications.filter((m) => m.id !== id);
  persistMedications();
  saveAndRender();
  renderMedications();
  renderClinicianBrief();
  toast("Regimen deleted");
}

function toggleMedicationStatus(id) {
  const med = medications.find((m) => m.id === id);
  if (!med) return;
  const current = med.status || "active";
  const next =
    current === "active"
      ? "paused"
      : current === "paused"
        ? "completed"
        : "active";
  med.status = next;
  if (next === "completed" && !med.endDate) {
    med.endDate = localISODate();
  } else if (next === "active") {
    med.endDate = null;
  }
  persistMedications();
  saveAndRender();
  renderMedications();
  renderClinicianBrief();
  toast(`${med.name} set to ${next}`);
}

function toggleMedicationSummaryInclusion(id) {
  const med = medications.find((m) => m.id === id);
  if (!med) return;
  med.includeInSummary = !(med.includeInSummary !== false);
  persistMedications();
  renderClinicianBrief();
  generateSummary();
}

function render() {
  const allItems = getAllTimelineItems();
  document.getElementById("recentTimeline").innerHTML = timelineMarkup(
    allItems.slice(0, 4),
  );
  renderTimelineOnly();
  renderStats();
  renderCycleReadiness();
  renderCycleChart();
  renderChangeComparison();
  renderPopulationComparison();
  renderSymptomPatterns();
  renderInsight();
  renderRecordNotes();
  renderMedications();
  renderClinicianBrief();
  const activeMedsCount = medications.filter(
    (m) => (m.status || "active") === "active",
  ).length;
  document.getElementById("recordSummaryCount").textContent =
    `${documents.length} file${documents.length === 1 ? "" : "s"} · ${activeMedsCount} active regimen${activeMedsCount === 1 ? "" : "s"}`;
}

function openLog(type) {
  currentType = type;
  document.getElementById("entryDate").value = localISODate();
  document.getElementById("entryDetail").value = "";
  setType(type);
  document.getElementById("modalBackdrop").classList.add("show");
}

function setType(type) {
  currentType = type;
  document.querySelectorAll(".type-switch button").forEach((button) => {
    button.classList.toggle("selected", button.dataset.type === type);
  });
  const labels = {
    period: "Log a period",
    symptom: "Add a check-in",
    context: "Mark a change",
    record: "Add a note",
  };
  const options = {
    period: ["Period started", "Period ended"],
    context: [
      "Medication change",
      "Routine change",
      "Stressful period",
      "Weight change",
      "Clinician-recorded diagnosis",
      "Other",
    ],
    record: ["Clinician note", "Test result note", "Other note"],
  };
  const isSymptom = type === "symptom";
  document.getElementById("modalTitle").textContent = labels[type];
  document.getElementById("titleField").hidden = isSymptom;
  document.getElementById("chipField").hidden = !isSymptom;
  if (isSymptom) {
    selectedChips.clear();
    document.getElementById("entryLabel").value = "";
    renderChips();
  } else {
    document.getElementById("entryTitle").innerHTML = options[type]
      .map((option) => `<option>${escapeHTML(option)}</option>`)
      .join("");
  }
}

function closeModal() {
  document.getElementById("modalBackdrop").classList.remove("show");
}

function saveEntry() {
  const date = document.getElementById("entryDate").value;
  if (!date) return toast("Choose a date first");
  if (currentType === "symptom") {
    const labels = [...selectedChips];
    document
      .getElementById("entryLabel")
      .value.split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((t) => {
        if (!labels.some((l) => l.toLowerCase() === t.toLowerCase()))
          labels.push(t);
      });
    if (!labels.length) return toast("Pick a symptom or type what you felt");
    const detail =
      document.getElementById("entryDetail").value.trim() || "Added by you";
    labels.forEach((label) =>
      entries.push({
        schemaVersion: CURRENT_SCHEMA_VERSION,
        id: newID(),
        date,
        type: "symptom",
        title: label,
        category: categoryFor(label),
        detail,
      }),
    );
    saveAndRender();
    closeModal();
    return toast(
      labels.length === 1
        ? "Saved to your timeline"
        : `${labels.length} check-ins saved`,
    );
  }
  entries.push({
    id: newID(),
    date,
    type: currentType,
    title: document.getElementById("entryTitle").value,
    detail:
      document.getElementById("entryDetail").value.trim() || "Added by you",
    periodRole:
      currentType === "period"
        ? document.getElementById("entryTitle").value === "Period ended"
          ? "end"
          : "start"
        : undefined,
  });
  saveAndRender();
  closeModal();
  toast("Saved to your timeline");
}

function newID() {
  return (
    globalThis.crypto?.randomUUID?.() ||
    `${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
}

function toast(message) {
  const element = document.getElementById("toast");
  element.textContent = message;
  element.classList.add("show");
  setTimeout(() => element.classList.remove("show"), 2300);
}

function toggleRecording() {
  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;
  const status = document.getElementById("voiceStatus");
  if (isRecording) return recognition?.stop();
  if (!SpeechRecognition) {
    const isFile = window.location.protocol === "file:";
    const isFirefox = navigator.userAgent.includes("Firefox");
    const isBrave = navigator.brave !== undefined;
    if (isFile) {
      status.textContent =
        "Voice capture requires running through http://localhost:3000 (not opening the HTML file directly).";
    } else if (isFirefox) {
      status.textContent =
        "Firefox does not support Web Speech recognition. Open http://localhost:3000 in Chrome, Edge, or Safari.";
    } else if (isBrave) {
      status.textContent =
        "Brave disables Web Speech by default. Try Google Chrome or Safari at http://localhost:3000.";
    } else {
      status.textContent =
        "Voice capture is not supported in this browser. Open http://localhost:3000 in Chrome, Edge, or Safari.";
    }
    document.getElementById("voiceText").focus();
    return;
  }

  recognition = new SpeechRecognition();
  recognition.lang = navigator.language || "en-US";
  recognition.continuous = true;
  recognition.interimResults = true;
  let captured = "";
  recognition.onstart = () => {
    isRecording = true;
    const button = document.getElementById("recordBtn");
    button.classList.add("is-recording");
    button.setAttribute("aria-pressed", "true");
    button.textContent = "Stop recording";
    status.textContent = "Listening. Stop when you have finished.";
  };
  recognition.onresult = (event) => {
    let interim = "";
    for (
      let index = event.resultIndex;
      index < event.results.length;
      index += 1
    ) {
      if (event.results[index].isFinal)
        captured += `${event.results[index][0].transcript} `;
      else interim += event.results[index][0].transcript;
    }
    document.getElementById("voiceText").value = `${captured}${interim}`.trim();
  };
  recognition.onerror = (event) => {
    isRecording = false;
    resetRecordButton();
    status.textContent =
      event.error === "not-allowed"
        ? "Microphone permission was not granted. You can type your check-in instead."
        : "Voice capture stopped. You can edit or type your check-in.";
  };
  recognition.onend = () => {
    isRecording = false;
    resetRecordButton();
    const note = document.getElementById("voiceText").value.trim();
    status.textContent = note
      ? "Review the transcript and dated details before saving."
      : "No words captured. Try again or type your check-in.";
    if (note) showVoiceReview(note);
  };
  try {
    recognition.start();
  } catch {
    status.textContent =
      "Could not start voice capture. Type your check-in below.";
  }
}

function resetRecordButton() {
  const button = document.getElementById("recordBtn");
  button.classList.remove("is-recording");
  button.setAttribute("aria-pressed", "false");
  button.innerHTML =
    '<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3Zm-7-3a7 7 0 0 0 14 0M12 18v4m-4 0h8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>&nbsp; Start voice check-in';
}

function reviewTypedCheckin() {
  const note = document.getElementById("voiceText").value.trim();
  if (!note) return toast("Speak or type a check-in first");
  showVoiceReview(note);
}

function refreshVoiceEvents() {
  const note = document.getElementById("reviewText").value.trim();
  voiceDraft = parseVoiceEvents(note);
  renderVoiceEvents();
}

function showVoiceReview(note) {
  document.getElementById("reviewText").value = note;
  refreshVoiceEvents();
  document.getElementById("voiceReview").classList.add("show");
  document.getElementById("addAsNote").checked = voiceDraft.length === 0;
  document.getElementById("voiceStatus").textContent = voiceDraft.length
    ? "Check the dates and details. You can change or remove any suggestion."
    : "I couldn't pick out dated details. Tick the box below to keep this note on your timeline.";
  document
    .getElementById("voiceReview")
    .scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function toggleSpokenTextEdit() {
  const container = document.getElementById("reviewTextContainer");
  const btn = document.getElementById("toggleTranscriptBtn");
  if (!container) return;
  const isHidden = container.style.display === "none";
  container.style.display = isHidden ? "block" : "none";
  if (btn) btn.textContent = isHidden ? "Hide words" : "Edit words";
}

function addVoiceEvent() {
  const custom = prompt(
    "What detail would you like to add? (e.g. Cramps, Headache, Spotting, Mood changes)",
  );
  if (!custom || !custom.trim()) return;
  voiceDraft.push({
    kind: "symptom",
    title: custom.trim(),
    date: localISODate(),
  });
  renderVoiceEvents();
}

function renderVoiceEvents() {
  const container = document.getElementById("voiceEvents");
  if (!voiceDraft.length) {
    container.innerHTML =
      '<p class="empty-state" style="padding:10px 0;font-size:12px;color:var(--muted)">No specific cycle details detected. Your check-in will still be kept in Records.</p>';
    return;
  }

  container.innerHTML = "";
  voiceDraft.forEach((event, index) => {
    const card = document.createElement("div");
    card.className = "voice-event-card";

    const isPeriod =
      event.kind === "period-start" || event.kind === "period-end";
    const isContext = event.kind === "context";
    const tagClass = isPeriod ? "period" : isContext ? "context" : "symptom";
    const tagLabel = isPeriod ? "Cycle" : isContext ? "Milestone" : "Check-in";

    const left = document.createElement("div");
    left.className = "voice-event-card-left";

    const tag = document.createElement("span");
    tag.className = `voice-event-tag ${tagClass}`;
    tag.textContent = tagLabel;

    const meta = document.createElement("div");
    meta.className = "voice-event-meta";

    const titleEl = document.createElement("div");
    titleEl.className = "voice-event-title";
    titleEl.textContent = event.title || "Check-in detail";

    const subEl = document.createElement("div");
    subEl.className = "voice-event-sub";

    const dateChip = document.createElement("label");
    dateChip.className = "voice-event-date-chip";
    dateChip.title = "Click to change date";

    const todayStr = localISODate();
    const diffDays = dayNumber(todayStr) - dayNumber(event.date);
    const dateLabel =
      diffDays === 0
        ? "Today"
        : diffDays === 1
          ? "Yesterday"
          : diffDays > 1 && diffDays <= 7
            ? `${diffDays} days ago`
            : formatDate(event.date, { month: "short", day: "numeric" });

    const dateText = document.createElement("span");
    dateText.textContent = dateLabel;

    const dateInput = document.createElement("input");
    dateInput.type = "date";
    dateInput.value = event.date;
    dateInput.addEventListener("change", () => {
      event.date = dateInput.value;
      renderVoiceEvents();
    });

    dateChip.append(dateText, dateInput);
    subEl.append(dateChip);

    meta.append(titleEl, subEl);
    left.append(tag, meta);

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "voice-event-remove";
    removeBtn.setAttribute("aria-label", `Remove ${event.title}`);
    removeBtn.innerHTML = "&times;";
    removeBtn.title = "Remove this detail";
    removeBtn.addEventListener("click", () => {
      voiceDraft.splice(index, 1);
      renderVoiceEvents();
    });

    card.append(left, removeBtn);
    container.append(card);
  });
}

function saveVoiceEntry() {
  const note = document.getElementById("reviewText").value.trim();
  if (!note) return toast("Add or dictate a note first");
  const sourceId = newID();
  const noteDate = localISODate();
  voiceNotes.unshift({ id: sourceId, date: noteDate, text: note });

  voiceDraft.forEach((event) => {
    const title = event.title.trim();
    if (!title || !event.date) return;
    const type = event.kind.startsWith("period-") ? "period" : event.kind;
    entries.push({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      id: newID(),
      sourceId,
      date: event.date,
      type,
      title,
      detail: "Added from your reviewed voice check-in",
      dateSource: event.dateSource || "inferred",
      periodRole:
        event.kind === "period-start"
          ? "start"
          : event.kind === "period-end"
            ? "end"
            : undefined,
    });
  });

  if (document.getElementById("addAsNote")?.checked) {
    entries.push({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      id: newID(),
      sourceId,
      date: noteDate,
      type: "record",
      title: "Check-in note",
      detail: note,
    });
  }

  persistVoiceNotes();
  saveAndRender();
  document.getElementById("voiceText").value = "";
  document.getElementById("reviewText").value = "";
  document.getElementById("voiceReview").classList.remove("show");
  document.getElementById("voiceStatus").textContent =
    "Saved. Your note and dated details are in your history.";
  voiceDraft = [];
  toast("Check-in and dated details saved");
}

function setSummaryRange(range) {
  currentSummaryRange = range;
  document
    .querySelectorAll(".summary-preset-chips .filter-chip")
    .forEach((chip) => {
      chip.classList.toggle("active", chip.dataset.range === range);
    });
  const customRow = document.getElementById("summaryCustomRow");
  if (customRow) {
    customRow.style.display = range === "custom" ? "flex" : "none";
  }
  updateSummaryFilterUI();
  renderClinicianBrief();
  generateSummary();
}

function applyCustomSummaryDates() {
  const startEl = document.getElementById("summaryCustomStart");
  const endEl = document.getElementById("summaryCustomEnd");
  summaryCustomStart = startEl ? startEl.value : null;
  summaryCustomEnd = endEl ? endEl.value : null;
  updateSummaryFilterUI();
  renderClinicianBrief();
  generateSummary();
}

function clearCustomSummaryDates() {
  const startEl = document.getElementById("summaryCustomStart");
  const endEl = document.getElementById("summaryCustomEnd");
  if (startEl) startEl.value = "";
  if (endEl) endEl.value = "";
  summaryCustomStart = null;
  summaryCustomEnd = null;
  setSummaryRange("all");
}

function getSummaryDateBounds() {
  let minDate = null;
  let maxDate = localISODate();

  if (currentSummaryRange === "3m") {
    const d = new Date();
    d.setMonth(d.getMonth() - 3);
    minDate = localISODate(d);
  } else if (currentSummaryRange === "6m") {
    const d = new Date();
    d.setMonth(d.getMonth() - 6);
    minDate = localISODate(d);
  } else if (currentSummaryRange === "12m") {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 1);
    minDate = localISODate(d);
  } else if (currentSummaryRange === "custom") {
    minDate = summaryCustomStart;
    maxDate = summaryCustomEnd || localISODate();
  }

  return { minDate, maxDate };
}

function getFilteredSummaryEntries() {
  if (currentSummaryRange === "all") return entries;
  const { minDate, maxDate } = getSummaryDateBounds();
  return entries.filter((e) => {
    if (minDate && e.date < minDate) return false;
    if (maxDate && e.date > maxDate) return false;
    return true;
  });
}

function getFilteredSummaryDocuments() {
  if (currentSummaryRange === "all") return documents;
  const { minDate, maxDate } = getSummaryDateBounds();
  return documents.filter((doc) => {
    if (!doc.recordDate) return true;
    if (minDate && doc.recordDate < minDate) return false;
    if (maxDate && doc.recordDate > maxDate) return false;
    return true;
  });
}

function updateSummaryFilterUI() {
  const label = document.getElementById("summaryRangeLabel");
  if (!label) return;
  const filteredEntries = getFilteredSummaryEntries();
  const startsCount = filteredEntries.filter(
    (e) =>
      e.type === "period" &&
      (e.periodRole === "start" || e.title === "Period started"),
  ).length;

  if (currentSummaryRange === "all") {
    label.textContent = `All logged history (${startsCount} period start${startsCount === 1 ? "" : "s"})`;
  } else if (currentSummaryRange === "3m") {
    label.textContent = `Past 3 months (${startsCount} start${startsCount === 1 ? "" : "s"})`;
  } else if (currentSummaryRange === "6m") {
    label.textContent = `Past 6 months (${startsCount} start${startsCount === 1 ? "" : "s"})`;
  } else if (currentSummaryRange === "12m") {
    label.textContent = `Past 1 year (${startsCount} start${startsCount === 1 ? "" : "s"})`;
  } else if (currentSummaryRange === "custom") {
    label.textContent = `${summaryCustomStart ? formatDate(summaryCustomStart) : "Earliest"} to ${summaryCustomEnd ? formatDate(summaryCustomEnd) : "Today"} (${startsCount} start${startsCount === 1 ? "" : "s"})`;
  }
}

function getConsolidatedQuestions(analysis, contextMarkers, summaryMeds = []) {
  const suggested = [];

  if (
    summaryMeds &&
    summaryMeds.some((m) => (m.status || "active") === "active")
  ) {
    const medNames = summaryMeds
      .filter((m) => (m.status || "active") === "active")
      .map((m) => m.name)
      .slice(0, 2)
      .join(" and ");
    suggested.push({
      id: "medication_review",
      text: `“I am currently taking ${medNames}. How should we evaluate tolerability, dosage timing, and its potential influence on my cycle patterns?”`,
      tag: "Regimen Review",
      tagClass: "info",
    });
  }

  if (
    analysis.populationComparison &&
    (analysis.populationComparison.band === "longer-90" ||
      analysis.populationComparison.band === "shorter-90")
  ) {
    suggested.push({
      id: "pop_outlier",
      text: `“My median cycle length of ${analysis.populationComparison.userMedian} days sits outside the 5th–95th percentile benchmark seen in large published studies (23–38 days). What potential physiological or hormonal factors should we consider exploring?”`,
      tag: "Population Benchmark",
      tagClass: "plum",
    });
  }
  if (
    analysis.flags.some(
      (f) => f.id === "variable_cycles" || f.id === "long_cycles",
    )
  ) {
    suggested.push({
      id: "cycle_variance",
      text: `“My recorded cycle lengths vary by ${analysis.summary ? analysis.summary.spread : ">9"} days. Would you recommend blood work (e.g. TSH, prolactin, free testosterone) or a pelvic ultrasound to investigate potential hormonal factors?”`,
      tag: "Clinical Regularity Flag",
      tagClass: "attention",
    });
  }
  if (analysis.flags.some((f) => f.id === "long_bleeding")) {
    suggested.push({
      id: "long_bleeding",
      text: "“My bleeding duration has reached over 8 days on several cycles. What could be contributing to prolonged bleeding, and should we evaluate for iron deficiency or polyps?”",
      tag: "Clinical Bleeding Flag",
      tagClass: "attention",
    });
  }
  if (analysis.flags.some((f) => f.id === "long_gap")) {
    suggested.push({
      id: "long_gap",
      text: "“It has been over 90 days since my last period start. What is the standard protocol for inducing a cycle or investigating secondary amenorrhea?”",
      tag: "Amenorrhea Check",
      tagClass: "attention",
    });
  }
  if (contextMarkers.length) {
    suggested.push({
      id: "context_shift",
      text: `“I recorded ${contextMarkers[0].title} on ${formatDate(contextMarkers[0].date)}. Could there be any connection between this shift and the cycle variance I'm seeing?”`,
      tag: "Milestone Correlation",
      tagClass: "green",
    });
  }
  if (!suggested.length) {
    suggested.push({
      id: "general_baseline",
      text: "“Given my recorded cycle range and symptoms, are there any preventive screenings or baseline tests you recommend discussing today?”",
      tag: "General Discussion",
      tagClass: "info",
    });
  }

  const custom = customQuestions.map((q) => ({
    id: q.id,
    text: q.text,
    tag: "Personal question",
    tagClass: "plum",
    isCustom: true,
  }));

  return [...custom, ...suggested];
}

function toggleQuestion(id) {
  if (disabledQuestionIds.has(id)) {
    disabledQuestionIds.delete(id);
  } else {
    disabledQuestionIds.add(id);
  }
  persistDisabledQuestions();
  renderClinicianBrief();
  generateSummary();
}

function addCustomQuestion() {
  const input = document.getElementById("newQuestionInput");
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;
  const newQ = { id: "custom_" + Date.now(), text, date: localISODate() };
  customQuestions.unshift(newQ);
  persistCustomQuestions();
  input.value = "";
  renderClinicianBrief();
  generateSummary();
  toast("Question added to your agenda");
}

function removeCustomQuestion(id) {
  customQuestions = customQuestions.filter((q) => q.id !== id);
  disabledQuestionIds.delete(id);
  persistCustomQuestions();
  persistDisabledQuestions();
  renderClinicianBrief();
  generateSummary();
}

function generateSummary() {
  updateSummaryFilterUI();
  const summaryEntries = getFilteredSummaryEntries();
  const summaryDocs = getFilteredSummaryDocuments();

  const starts = periodStarts(summaryEntries);
  const intervals = cycleIntervals(summaryEntries);
  const durations = bleedingDurations(summaryEntries);
  const cycleNotes = starts.length
    ? starts.map(
        (entry) =>
          `• Period started: ${formatDate(entry.date)}${entry.detail && entry.detail !== "Added by you" ? ` — ${entry.detail}` : ""}`,
      )
    : ["• No period start dates recorded in this observation window."];
  if (intervals.length) {
    cycleNotes.push(
      ...intervals.map(
        (item) =>
          `• Cycle interval: ${formatDate(item.start.date)} to ${formatDate(item.end.date)} — ${item.days} days`,
      ),
    );
  }
  cycleNotes.push(
    ...(durations.length
      ? durations.map(
          (item) =>
            `• Bleeding: ${formatDate(item.start.date)} to ${formatDate(item.end.date)} — ${item.days} days`,
        )
      : ["• Bleeding duration: no start/end date pairs recorded in window."]),
  );

  const notes = summaryEntries
    .filter(
      (entry) =>
        !entry.sourceId &&
        ["symptom", "context", "record"].includes(entry.type),
    )
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(
      (entry) =>
        `• ${formatDate(entry.date)} — ${entry.title}${entry.detail && entry.detail !== "Added by you" ? `: ${entry.detail}` : ""}`,
    );

  const { minDate, maxDate } = getSummaryDateBounds();
  const spokenNotes = voiceNotes
    .filter(
      (n) => (!minDate || n.date >= minDate) && (!maxDate || n.date <= maxDate),
    )
    .slice()
    .reverse()
    .map((note) => `• ${formatDate(note.date)} — “${note.text}”`);

  const summaryMeds = filterMedicationsByWindow(medications, minDate, maxDate);
  const selectedMeds = summaryMeds.filter((m) => m.includeInSummary !== false);
  const medNotes = selectedMeds.length
    ? selectedMeds.map((m) => formatRegimenLine(m, localISODate()))
    : ["• No medications or supplements selected for this observation window."];

  const selectedDocuments = summaryDocs.filter(
    (document) =>
      document.includeInSummary &&
      ((document.notes && document.notes.trim()) ||
        (document.keyFinding && document.keyFinding.trim())),
  );
  const recordNotes = selectedDocuments.map((document) => {
    const parts = [];
    if (document.category) parts.push(`[${document.category}]`);
    if (document.keyFinding) parts.push(`Key: ${document.keyFinding}`);
    if (document.notes) parts.push(document.notes);
    return `• ${document.name}${document.recordDate ? ` (${formatDate(document.recordDate)})` : ""} — ${parts.join(" · ") || "Included"}`;
  });

  const analysis = analyze(summaryEntries, {
    today: localISODate(),
    rules: RULES,
  });
  const flagLines = analysis.flags.length
    ? analysis.flags.map((f) => `• ${f.title}: ${f.message}`)
    : [
        "• No out-of-range pattern flags under FIGO 2018 criteria in this observation window.",
      ];

  const popComp = analysis.populationComparison;
  const popLines = popComp
    ? [
        `• Patient Median: ${popComp.userMedian} days (Population Median: ${popComp.populationMedian} days, Middle 50%: ${popComp.middle50.min}–${popComp.middle50.max} days, Middle 90%: ${popComp.middle90.min}–${popComp.middle90.max} days)`,
        `• Distribution Position: ${popComp.bandLabel} (${popComp.percentileEstimate})`,
        popComp.variationComparison
          ? `• Within-Individual Variation: ${popComp.variationComparison.message}`
          : "",
      ].filter(Boolean)
    : ["• Need 2+ period starts in window to calculate population comparison."];

  const contextMarkers = summaryEntries
    .filter((e) => e.type === "context")
    .sort((a, b) => b.date.localeCompare(a.date));
  const allQuestions = getConsolidatedQuestions(
    analysis,
    contextMarkers,
    summaryMeds,
  );
  const activeQuestions = allQuestions.filter(
    (q) => !disabledQuestionIds.has(q.id),
  );
  const questionLines = activeQuestions.length
    ? activeQuestions.map((q) => `• ${q.text}`)
    : ["• (No questions currently selected for appointment agenda)"];

  const filterLabelEl = document.getElementById("summaryRangeLabel");
  const windowDescription = filterLabelEl
    ? filterLabelEl.textContent
    : "All logged history";

  const section = (title, lines) => `${title}\n${lines.join("\n")}`;
  const value = [
    section("OBSERVATION TIMEFRAME & OBSERVATION WINDOW", [
      `• Timeframe filter: ${windowDescription}`,
      `• Prepared on: ${formatDate(localISODate())}`,
    ]),
    section("CYCLE DATES & LENGTHS", cycleNotes),
    section(
      "PATTERNS WORTH DISCUSSING (FIGO 2018 criteria — pending clinical review)",
      flagLines,
    ),
    section(
      "POPULATION BENCHMARK CONTEXT (Bull et al. 2019, n=612k cycles)",
      popLines,
    ),
    section("CURRENT MEDICATIONS & SUPPLEMENTS", medNotes),
    section(
      "CONTEXT MILESTONES & INTERVENTIONS",
      contextMarkers.length
        ? contextMarkers.map(
            (m) =>
              `• ${formatDate(m.date)}: ${m.title} — ${m.detail || "Marked by you"}`,
          )
        : ["• No context milestones recorded in window."],
    ),
    section(
      "SYMPTOMS & CHECK-INS",
      notes.length ? notes : ["• No symptoms recorded in window."],
    ),
    section(
      "VOICE CHECK-INS",
      spokenNotes.length
        ? spokenNotes
        : ["• No voice check-ins recorded in window."],
    ),
    section(
      "MEDICAL RECORDS TO DISCUSS",
      recordNotes.length
        ? recordNotes
        : ["• No record notes selected in window."],
    ),
    section("QUESTIONS & DISCUSSION AGENDA FOR YOUR DOCTOR", questionLines),
  ].join("\n\n");

  const field = document.getElementById("summaryText");
  if (field) {
    field.value = value;
    field.dataset.generated = "true";
  }
}

async function copySummary() {
  const field = document.getElementById("summaryText");
  if (!field.value) generateSummary();
  try {
    await navigator.clipboard.writeText(field.value);
    toast("Summary copied");
  } catch {
    field.select();
    document.execCommand("copy");
    toast("Summary copied");
  }
}

function renderClinicianBrief() {
  const container = document.getElementById("clinicalBriefContent");
  if (!container) return;

  updateSummaryFilterUI();
  const summaryEntries = getFilteredSummaryEntries();
  const summaryDocs = getFilteredSummaryDocuments();

  const starts = periodStarts(summaryEntries);
  const intervals = cycleIntervals(summaryEntries);
  const durations = bleedingDurations(summaryEntries);
  const analysis = analyze(summaryEntries, {
    today: localISODate(),
    rules: RULES,
  });

  const earliestDate = starts.length ? starts[0].date : localISODate();
  const latestDate = starts.length
    ? starts[starts.length - 1].date
    : localISODate();

  let freqValue = "—";
  let freqSub = "Insufficient data";
  let freqStatus = { text: "Need 2+ starts", class: "info" };
  if (analysis.summary) {
    freqValue = `${analysis.summary.min}–${analysis.summary.max} d`;
    freqSub = `Across last ${analysis.basedOnCycles} cycles in window`;
    const isNormal = analysis.summary.min >= 24 && analysis.summary.max <= 38;
    freqStatus = isNormal
      ? { text: "Normal frequency (24–38d)", class: "normal" }
      : {
          text:
            analysis.summary.max > 38
              ? "Infrequent / Variable (>38d)"
              : "Frequent (<24d)",
          class: "attention",
        };
  } else if (intervals.length) {
    const min = Math.min(...intervals.map((i) => i.days));
    const max = Math.max(...intervals.map((i) => i.days));
    freqValue = `${min}–${max} d`;
    freqSub = `${intervals.length} recorded interval${intervals.length === 1 ? "" : "s"}`;
  }

  let spreadValue = "—";
  let spreadSub = "Difference (max - min)";
  let spreadStatus = { text: "Pending data", class: "info" };
  if (analysis.summary) {
    spreadValue = `±${analysis.summary.spread} days`;
    spreadSub = "Spread between shortest & longest";
    spreadStatus =
      analysis.summary.spread <= 9
        ? { text: "Regular spread (≤9 days)", class: "normal" }
        : {
            text: `Irregular spread (${analysis.summary.spread}d > 9d)`,
            class: "attention",
          };
  }

  let bleedValue = "—";
  let bleedSub = "Start to end duration";
  let bleedStatus = { text: "Need start + end dates", class: "info" };
  if (durations.length) {
    const minD = Math.min(...durations.map((d) => d.days));
    const maxD = Math.max(...durations.map((d) => d.days));
    bleedValue = minD === maxD ? `${minD} days` : `${minD}–${maxD} days`;
    bleedSub = `Based on ${durations.length} recorded period${durations.length === 1 ? "" : "s"}`;
    bleedStatus =
      maxD <= 8
        ? { text: "Normal duration (≤8 days)", class: "normal" }
        : { text: "Prolonged bleeding (>8 days)", class: "attention" };
  }

  let gapValue = "—";
  let gapSub = "Days since last start";
  let gapStatus = { text: "No starts logged", class: "info" };
  if (starts.length) {
    const lastStart = starts[starts.length - 1].date;
    const daysSince = Math.max(
      0,
      Math.round((Date.now() - Date.parse(`${lastStart}T12:00:00`)) / 86400000),
    );
    gapValue = `${daysSince} days`;
    gapSub = `Since ${formatDate(lastStart)}`;
    gapStatus =
      daysSince > 90
        ? { text: "Prolonged gap (>90d)", class: "attention" }
        : {
            text:
              daysSince > 38
                ? "Current cycle length extended"
                : "Current cycle in progress",
            class: daysSince > 38 ? "attention" : "normal",
          };
  }

  const contextMarkers = summaryEntries
    .filter((e) => e.type === "context")
    .sort((a, b) => b.date.localeCompare(a.date));
  let interventionHTML =
    '<p class="empty-state">No medical or lifestyle context markers logged in this timeframe.</p>';
  if (contextMarkers.length) {
    const rows = contextMarkers
      .map((m) => {
        const before = intervals
          .filter((i) => i.end.date <= m.date)
          .map((i) => i.days);
        const after = intervals
          .filter((i) => i.start.date >= m.date)
          .map((i) => i.days);
        const beforeStr = before.length
          ? `${Math.min(...before)}–${Math.max(...before)} d (n=${before.length})`
          : "—";
        const afterStr = after.length
          ? `${Math.min(...after)}–${Math.max(...after)} d (n=${after.length})`
          : "—";
        return `<tr>
        <td><strong>${escapeHTML(m.title)}</strong><br><small style="color:var(--muted)">${formatDate(m.date)} · ${escapeHTML(m.detail || "Marked by you")}</small></td>
        <td>${beforeStr}</td>
        <td>${afterStr}</td>
      </tr>`;
      })
      .join("");
    interventionHTML = `<table class="brief-table">
      <thead><tr><th>Context Marker</th><th>Cycle Range Before</th><th>Cycle Range After</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  }

  const groupedSymptoms = new Map();
  summaryEntries
    .filter((e) => e.type === "symptom")
    .forEach((e) => {
      const name = e.title.trim();
      if (!name) return;
      const key = name.toLowerCase();
      const curr = groupedSymptoms.get(key);
      groupedSymptoms.set(key, {
        name: curr?.name || name,
        count: (curr?.count || 0) + 1,
      });
    });
  const topSymptoms = [...groupedSymptoms.values()].sort(
    (a, b) => b.count - a.count,
  );

  const symptomCorrelations = analyzeSymptomCorrelations(summaryEntries);
  let symptomsHTML =
    '<p class="empty-state">No symptoms recorded in this timeframe.</p>';

  if (symptomCorrelations.correlations.length) {
    const tableRows = symptomCorrelations.correlations
      .map((c) => {
        const recBadgeClass =
          c.cycleRecurrenceRate >= 60
            ? "high"
            : c.cycleRecurrenceRate >= 40
              ? "moderate"
              : "low";
        const dominantSlug = c.dominantPhase?.slug || "unlinked";
        const dominantShort = c.dominantPhase?.shortName || "Unlinked";
        return `
        <tr>
          <td><strong>${escapeHTML(c.name)}</strong><br><small style="color:var(--muted)">${c.totalOccurrences} total log${c.totalOccurrences === 1 ? "" : "s"}</small></td>
          <td>
            <span class="recurrence-badge ${recBadgeClass}">${c.cycleRecurrenceRate}%</span>
            <div style="font-size:11px;color:var(--muted);margin-top:2px">${c.cyclesWithSymptom} of ${c.totalCyclesObserved} cycle${c.totalCyclesObserved === 1 ? "" : "s"}</div>
          </td>
          <td>
            <span class="phase-pill ${dominantSlug}">${escapeHTML(dominantShort)}</span>
            <div style="font-size:11px;color:var(--muted);margin-top:2px">${c.dominantPhase ? `${c.dominantPhase.cyclesInPhase} cycle${c.dominantPhase.cyclesInPhase === 1 ? "" : "s"}` : "—"}</div>
          </td>
          <td style="font-size:11px;line-height:1.4">
            ${escapeHTML(c.clinicalSummary)}
          </td>
        </tr>
      `;
      })
      .join("");

    symptomsHTML = `
      <table class="brief-symptoms-table">
        <thead>
          <tr>
            <th>Symptom</th>
            <th>Cycle Recurrence</th>
            <th>Dominant Phase</th>
            <th>Observational Summary</th>
          </tr>
        </thead>
        <tbody>
          ${tableRows}
        </tbody>
      </table>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:10px">
        ${topSymptoms.map((s) => `<span class="tag plum" style="font-size:11px;padding:3px 8px">${escapeHTML(s.name)} <strong>(${s.count}×)</strong></span>`).join("")}
      </div>
    `;
  }

  const selectedDocs = summaryDocs.filter(
    (d) =>
      d.includeInSummary &&
      ((d.notes && d.notes.trim()) || (d.keyFinding && d.keyFinding.trim())),
  );
  const docsHTML = selectedDocs.length
    ? `<ul style="margin:8px 0 0 18px;padding:0;font-size:13px;color:var(--ink)">${selectedDocs.map((d) => `<li style="margin-bottom:6px"><strong>${escapeHTML(d.name)}</strong>${d.category ? ` <span class="tag lab-tag" style="font-size:10px;padding:2px 7px">${escapeHTML(d.category)}</span>` : ""}${d.extractionConfirmed ? ` <span class="tag lab-tag" style="font-size:10px;padding:2px 7px">Extracted from report (confirmed by you)</span>` : ""}${d.recordDate ? ` (${formatDate(d.recordDate)})` : ""}: ${d.keyFinding ? `<span style="color:#0369a1;font-weight:600">${escapeHTML(d.keyFinding)}</span>${d.notes ? " · " : ""}` : ""}${escapeHTML(d.notes || "")}</li>`).join("")}</ul>`
    : '<p class="empty-state">No document notes selected for this appointment window.</p>';

  const { minDate, maxDate } = getSummaryDateBounds();
  const summaryMeds = filterMedicationsByWindow(medications, minDate, maxDate);
  let medsBriefHTML =
    '<p class="empty-state">No medications or supplements recorded in this appointment observation window.</p>';
  if (summaryMeds.length) {
    const medRows = summaryMeds
      .map((m) => {
        const duration = calculateRegimenDuration(
          m.startDate,
          m.endDate,
          localISODate(),
        );
        const isIncluded = m.includeInSummary !== false;
        const statusClass = m.status || "active";
        return `<tr>
        <td style="width:36px;text-align:center">
          <input type="checkbox" id="chk_med_${m.id}" ${isIncluded ? "checked" : ""} onchange="toggleMedicationSummaryInclusion('${m.id}')" aria-label="Include ${escapeHTML(m.name)} in brief">
        </td>
        <td>
          <strong>${escapeHTML(m.name)}</strong>
          <span class="med-category-pill ${m.category || "medication"}" style="margin-left:6px">${escapeHTML(m.category || "medication")}</span>
          ${m.notes ? `<div style="font-size:11px;color:var(--muted);margin-top:2px">${escapeHTML(m.notes)}</div>` : ""}
        </td>
        <td><strong>${escapeHTML(m.dosage || "—")}</strong><br><small style="color:var(--muted)">${escapeHTML(m.frequency || "Daily")}</small></td>
        <td>
          <span class="med-status-pill ${statusClass}">${statusClass}</span>
          <div style="font-size:11px;color:var(--plum);margin-top:3px">${duration.durationText}</div>
        </td>
        <td style="font-size:11px;color:var(--muted)">
          ${m.endDate ? `${formatDate(m.startDate)} – ${formatDate(m.endDate)}` : `Since ${formatDate(m.startDate)}`}
        </td>
      </tr>`;
      })
      .join("");

    medsBriefHTML = `<table class="brief-table">
      <thead>
        <tr>
          <th style="width:36px">Include</th>
          <th>Regimen &amp; Notes</th>
          <th>Dosage &amp; Timing</th>
          <th>Status &amp; Duration</th>
          <th>Start / End</th>
        </tr>
      </thead>
      <tbody>${medRows}</tbody>
    </table>`;
  }

  const allQuestions = getConsolidatedQuestions(
    analysis,
    contextMarkers,
    summaryMeds,
  );
  const questionsHTML = `
    <div class="question-list">
      ${allQuestions
        .map((q, idx) => {
          const isEnabled = !disabledQuestionIds.has(q.id);
          const numLabel = `Q${idx + 1}`;
          const deleteBtn = q.isCustom
            ? `<button type="button" class="question-remove-btn" onclick="removeCustomQuestion('${q.id}')" title="Delete question">×</button>`
            : "";
          return `
          <div class="question-item ${isEnabled ? "" : "disabled"}">
            <div class="question-check-wrap">
              <input type="checkbox" id="chk_${q.id}" ${isEnabled ? "checked" : ""} onchange="toggleQuestion('${q.id}')" aria-label="Include question in agenda">
            </div>
            <div class="question-content-wrap">
              <div>
                <strong style="color:var(--plum);margin-right:6px">${numLabel}</strong>
                <span>${escapeHTML(q.text)}</span>
              </div>
              <div class="question-meta-row">
                <span class="tag ${q.tagClass}" style="font-size:10px">${escapeHTML(q.tag)}</span>
                ${deleteBtn}
              </div>
            </div>
          </div>
        `;
        })
        .join("")}
    </div>
    <div class="add-question-box">
      <input type="text" id="newQuestionInput" placeholder="Add your own question or discussion topic for your doctor..." onkeydown="if(event.key==='Enter'){event.preventDefault();addCustomQuestion();}">
      <button class="btn primary" type="button" onclick="addCustomQuestion()">＋ Add question</button>
    </div>
  `;

  updateBriefOptionsUI();
  const execData = buildExecutiveSummaryData({
    analysis,
    intervals,
    durations,
    medications: summaryMeds,
    questions: allQuestions.filter((q) => !disabledQuestionIds.has(q.id)),
    documents: selectedDocs,
  });

  const sparklineSVG = generateCycleSparklineSVG(intervals, {
    width: 680,
    height: printPrefs.compactOnePage ? 115 : 135,
  });

  container.className = `clinical-brief${printPrefs.compactOnePage ? " compact-print-mode" : ""}`;

  const patientDisplay = escapeHTML(
    printPrefs.patientRef?.trim() || "Patient Record",
  );
  const physicianDisplay = escapeHTML(printPrefs.physicianRef?.trim() || "");

  container.innerHTML = `
    <div class="brief-header">
      <div class="brief-header-top">
        <div>
          <span style="font-size:11px;font-weight:700;letter-spacing:1px;color:var(--plum);text-transform:uppercase">Cycle Context · Clinical Consultation Brief</span>
          <h2>${patientDisplay} · Cycle &amp; Symptom Summary</h2>
          ${physicianDisplay ? `<div style="font-size:12px;font-weight:600;color:var(--ink);margin-top:2px">Prepared for: ${physicianDisplay}</div>` : ""}
        </div>
        <div class="brief-meta">
          <strong>Prepared:</strong> ${formatClinicalDate(localISODate())}<br>
          <strong>Observation Window:</strong> ${formatClinicalDate(earliestDate)} to ${formatClinicalDate(latestDate)} (${starts.length} period start${starts.length === 1 ? "" : "s"}, ${intervals.length} interval${intervals.length === 1 ? "" : "s"})
        </div>
      </div>
      <div class="brief-disclaimer">
        <strong>Note for Healthcare Provider:</strong> This brief is compiled directly from personal health journals kept by the patient on their device. Cycle variation and duration metrics are benchmarked against FIGO (International Federation of Gynecology and Obstetrics) 2018 clinical definitions to assist in your evaluation. It does not contain automated diagnoses or algorithmic treatments.
      </div>
    </div>

    <!-- Executive Clinical Overview -->
    <div class="brief-section ${printPrefs.sections.execSummary ? "" : "is-hidden"}" id="briefSec_execSummary">
      <div class="brief-executive-summary">
        <div class="exec-header">
          <span class="exec-header-title">Executive Clinical Overview</span>
          <span class="tag ${execData.freqBadge === "normal" && execData.regularityBadge === "normal" ? "green" : "plum"}" style="font-size:10px">Clinical Baseline</span>
        </div>
        <div class="exec-grid">
          <div class="exec-card">
            <div class="exec-label">Cycle Frequency</div>
            <div class="exec-val">${execData.freqCategory}</div>
            <div class="exec-sub">${execData.freqDetail}</div>
            <span class="clinical-status-pill ${execData.freqBadge}" style="margin-top:6px">${execData.freqBadge === "normal" ? "Normal FIGO" : "Attention"}</span>
          </div>
          <div class="exec-card">
            <div class="exec-label">Regularity Spread</div>
            <div class="exec-val">${execData.regularityCategory}</div>
            <div class="exec-sub">${execData.regularityDetail}</div>
            <span class="clinical-status-pill ${execData.regularityBadge}" style="margin-top:6px">${execData.regularityBadge === "normal" ? "Regular ≤9d" : "Irregular >9d"}</span>
          </div>
          <div class="exec-card">
            <div class="exec-label">Bleeding Duration</div>
            <div class="exec-val">${execData.bleedCategory}</div>
            <div class="exec-sub">${execData.bleedDetail}</div>
            <span class="clinical-status-pill ${execData.bleedBadge}" style="margin-top:6px">${execData.bleedBadge === "normal" ? "≤8 days normal" : "Prolonged"}</span>
          </div>
          <div class="exec-card">
            <div class="exec-label">Active Regimens</div>
            <div class="exec-val">${execData.activeMedsCount} Active</div>
            <div class="exec-sub">${escapeHTML(execData.activeMedsSummary)}</div>
          </div>
        </div>
        ${
          execData.priorityQuestions.length
            ? `
          <div class="exec-priority-agenda">
            <strong class="exec-priority-title">Chief Inquiries for Appointment:</strong>
            ${execData.priorityQuestions.map((q, i) => `<span>(${i + 1}) ${escapeHTML(q)}</span>`).join(" &nbsp;·&nbsp; ")}
          </div>
        `
            : ""
        }
      </div>
    </div>

    <!-- Cycle Sparkline Visual -->
    <div class="brief-section ${printPrefs.sections.sparkline ? "" : "is-hidden"}" id="briefSec_sparkline">
      <div class="brief-section-title">Cycle History &amp; Trend Sparkline (${intervals.length} recorded interval${intervals.length === 1 ? "" : "s"})</div>
      <div class="brief-sparkline-card">
        ${sparklineSVG}
        <div class="brief-sparkline-legend">
          <span class="legend-item"><span class="legend-swatch normal-band"></span> FIGO Normal Frequency Range (24–38 days)</span>
          <span class="legend-item"><span class="legend-swatch median-line"></span> Population Median 29.0d (Bull et al. 2019)</span>
          <span class="legend-item"><span class="legend-swatch cycle-bar"></span> Cycle Interval</span>
          <span class="legend-item"><span class="legend-swatch outlier-bar"></span> Prolonged (>38d) / Shortened (<24d)</span>
        </div>
      </div>
    </div>

    <!-- FIGO Menstrual History Metrics -->
    <div class="brief-section ${printPrefs.sections.figo ? "" : "is-hidden"}" id="briefSec_figo">
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

    <!-- Population Benchmark Layer -->
    <div class="brief-section ${printPrefs.sections.population ? "" : "is-hidden"}" id="briefSec_population">
      <div class="brief-section-title">2. Population Benchmark Layer (Bull et al. 2019, n=612k)</div>
      ${(() => {
        const pop = analysis.populationComparison;
        if (!pop)
          return '<p class="empty-state">Need 2 or more period starts in window to compare with population study data.</p>';
        return `
          <div class="clinical-grid">
            <div class="clinical-metric-card">
              <div>
                <div class="clinical-metric-label">Patient vs Study Median</div>
                <div class="clinical-metric-value">${pop.userMedian}d <span style="font-size:14px;color:var(--muted);font-weight:400">vs ${pop.populationMedian}d</span></div>
                <div class="clinical-metric-sub">Study mean: ${pop.populationMean}d (Bull et al. 2019)</div>
              </div>
              <span class="clinical-status-pill ${pop.band === "middle50" ? "normal" : "info"}">${pop.percentileEstimate}</span>
            </div>
            <div class="clinical-metric-card">
              <div>
                <div class="clinical-metric-label">Study Middle 50% (IQR)</div>
                <div class="clinical-metric-value">${pop.middle50.min}–${pop.middle50.max} d</div>
                <div class="clinical-metric-sub">25th to 75th percentile of cycles</div>
              </div>
              <span class="clinical-status-pill info">${pop.bandLabel.split("(")[0].trim()}</span>
            </div>
            <div class="clinical-metric-card">
              <div>
                <div class="clinical-metric-label">Study Middle 90% Range</div>
                <div class="clinical-metric-value">${pop.middle90.min}–${pop.middle90.max} d</div>
                <div class="clinical-metric-sub">5th to 95th percentile of cycles</div>
              </div>
              <span class="clinical-status-pill normal">Study reference</span>
            </div>
            <div class="clinical-metric-card">
              <div>
                <div class="clinical-metric-label">Cycle Spread Context</div>
                <div class="clinical-metric-value">±${pop.userSpread} d</div>
                <div class="clinical-metric-sub">${pop.variationComparison ? (pop.variationComparison.isTypical ? "Within typical variation (≤9d)" : "Above typical 90% threshold (9d)") : "Need 2+ cycles"}</div>
              </div>
              <span class="clinical-status-pill ${pop.variationComparison?.isTypical ? "normal" : "attention"}">${pop.variationComparison?.isTypical ? "Typical variance" : "Elevated variance"}</span>
            </div>
          </div>
          <div class="callout" style="margin-top:8px">
            <strong>Context note:</strong> Aggregated data from 612,613 menstrual cycles (Bull et al., <em>npj Digital Medicine</em> 2019). Provided as an empirical baseline to complement clinical judgment and the patient's individual FIGO metrics.
          </div>
        `;
      })()}
    </div>

    <!-- Medications and Supplements -->
    <div class="brief-section ${printPrefs.sections.meds ? "" : "is-hidden"}" id="briefSec_meds">
      <div class="brief-section-title">3. Current Medications &amp; Supplements (${summaryMeds.filter((m) => m.includeInSummary !== false).length} selected)</div>
      ${medsBriefHTML}
    </div>

    <!-- Milestones -->
    <div class="brief-section ${printPrefs.sections.context ? "" : "is-hidden"}" id="briefSec_context">
      <div class="brief-section-title">4. Context Milestones &amp; Interventions</div>
      ${interventionHTML}
    </div>

    <!-- Symptoms Profile -->
    <div class="brief-section ${printPrefs.sections.symptoms ? "" : "is-hidden"}" id="briefSec_symptoms">
      <div class="brief-section-title">5. Reported Symptoms &amp; Phase Recurrence (${topSymptoms.length} recorded)</div>
      ${symptomsHTML}
    </div>

    <!-- Medical Records & Documents -->
    <div class="brief-section ${printPrefs.sections.docs ? "" : "is-hidden"}" id="briefSec_docs">
      <div class="brief-section-title">6. Medical Records &amp; Documents Selected</div>
      ${docsHTML}
    </div>

    <!-- Discussion Agenda -->
    <div class="brief-section ${printPrefs.sections.agenda ? "" : "is-hidden"}" id="briefSec_agenda">
      <div class="brief-section-title">7. Discussion Agenda for Your Doctor (${allQuestions.filter((q) => !disabledQuestionIds.has(q.id)).length} selected)</div>
      ${questionsHTML}
    </div>
  `;
}

function switchSummaryView(mode) {
  const briefBtn = document.getElementById("viewBriefBtn");
  const rawBtn = document.getElementById("viewRawBtn");
  const briefContainer = document.getElementById("briefViewContainer");
  const rawContainer = document.getElementById("rawViewContainer");

  if (mode === "brief") {
    briefBtn.classList.add("active");
    rawBtn.classList.remove("active");
    briefContainer.hidden = false;
    rawContainer.hidden = true;
    renderClinicianBrief();
  } else {
    rawBtn.classList.add("active");
    briefBtn.classList.remove("active");
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
        request.result.createObjectStore(DOCUMENT_STORE, { keyPath: "id" });
      }
      if (!request.result.objectStoreNames.contains(DOCUMENT_FILE_STORE)) {
        request.result.createObjectStore(DOCUMENT_FILE_STORE, {
          keyPath: "id",
        });
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
    const request = db
      .transaction(DOCUMENT_STORE)
      .objectStore(DOCUMENT_STORE)
      .getAll();
    request.onsuccess = () =>
      resolve(
        request.result.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt)),
      );
    request.onerror = () => reject(request.error);
  });
}

async function getDocument(id) {
  const db = await openDocumentDatabase();
  return new Promise((resolve, reject) => {
    const request = db
      .transaction(DOCUMENT_FILE_STORE)
      .objectStore(DOCUMENT_FILE_STORE)
      .get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function putDocument(documentRecord) {
  const db = await openDocumentDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(
      [DOCUMENT_STORE, DOCUMENT_FILE_STORE],
      "readwrite",
    );
    const { blob, ...metadata } = documentRecord;
    transaction.objectStore(DOCUMENT_STORE).put(metadata);
    if (blob)
      transaction
        .objectStore(DOCUMENT_FILE_STORE)
        .put({ id: documentRecord.id, blob });
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
}

async function handleDocumentFiles(input) {
  const files = [...input.files];
  input.value = "";
  let autoExtractDocId = null;
  let autoExtractText = "";
  for (const file of files) {
    if (file.size > MAX_FILE_SIZE) {
      toast(`${file.name} is larger than 25 MB and was skipped`);
      continue;
    }
    try {
      const docId = newID();
      let textContent = "";
      if (file.type.includes("text") || file.name.endsWith(".txt")) {
        try {
          textContent = await file.text();
          autoExtractDocId = docId;
          autoExtractText = textContent;
        } catch (e) {
          console.warn("Could not read text from file:", e);
        }
      }
      await putDocument({
        id: docId,
        name: file.name,
        mime: file.type || "File",
        size: file.size,
        uploadedAt: localISODate(),
        recordDate: "",
        notes: "",
        includeInSummary: false,
        blob: file,
      });
    } catch {
      toast("This browser could not save the document. Try another browser.");
      return;
    }
  }
  await loadDocuments();
  if (files.length)
    toast(
      `${files.length} document${files.length === 1 ? "" : "s"} added to this device`,
    );
  if (autoExtractDocId && autoExtractText) {
    openReportExtractionModal(autoExtractDocId, autoExtractText);
  }
}

async function loadDocuments() {
  invalidateAppCaches();
  try {
    documents = await getAllDocuments();
  } catch {
    documents = [];
    toast("Private document storage is not available in this browser");
  }
  renderDocuments();
  renderTimelineOnly();
}

function formatFileSize(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function renderDocuments() {
  const list = document.getElementById("documentsList");
  document.getElementById("documentCount").textContent =
    `${documents.length} file${documents.length === 1 ? "" : "s"}`;
  document.getElementById("recordSummaryCount").textContent =
    `${documents.length} file${documents.length === 1 ? "" : "s"} · ${entries.filter((entry) => entry.type === "record").length} note${entries.filter((entry) => entry.type === "record").length === 1 ? "" : "s"}`;
  const latestNote = entries
    .filter((entry) => entry.type === "record")
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  document.getElementById("recordSummaryPreview").innerHTML = documents.length
    ? `<div><strong>${escapeHTML(documents[0].name)}</strong><small>${documents.length} private file${documents.length === 1 ? "" : "s"} on this device</small></div><span class="tag green">Private</span>`
    : latestNote
      ? `<div><strong>${escapeHTML(latestNote.title)}</strong><small>Added by you · ${formatDate(latestNote.date)}</small></div><span class="tag green">Private</span>`
      : "<div><strong>Your private record library</strong><small>Reports and notes stay on this device</small></div>";

  if (!documents.length) {
    list.innerHTML = '<p class="empty-state">No documents added yet.</p>';
    return;
  }

  list.innerHTML = "";
  documents.forEach((documentRecord) => {
    const article = document.createElement("article");
    article.className = "document-record";
    const heading = document.createElement("div");
    heading.className = "document-record-heading";
    const title = document.createElement("strong");
    title.textContent = documentRecord.name;
    const info = document.createElement("small");
    info.textContent = `${documentRecord.mime} · ${formatFileSize(documentRecord.size)} · added ${formatDate(documentRecord.uploadedAt)}`;
    heading.append(title, info);

    if (documentRecord.extractionConfirmed) {
      const provBadge = document.createElement("span");
      provBadge.className = "tag lab-tag";
      provBadge.style.marginTop = "4px";
      provBadge.textContent = "Extracted from report (confirmed by you)";
      heading.append(provBadge);
    }

    const fieldsGrid = document.createElement("div");
    fieldsGrid.className = "document-record-fields";

    const catLabel = document.createElement("label");
    catLabel.textContent = "Report category";
    const catSelect = document.createElement("select");
    const categories = [
      "Blood / Hormone panel",
      "Pelvic / Follicle Ultrasound",
      "Clinician consultation note",
      "Prescription / Medication",
      "Pathology / Lab report",
      "Other medical report",
    ];
    categories.forEach((cat) => {
      const opt = document.createElement("option");
      opt.value = cat;
      opt.textContent = cat;
      if ((documentRecord.category || "Blood / Hormone panel") === cat)
        opt.selected = true;
      catSelect.append(opt);
    });
    catLabel.append(catSelect);

    const dateLabel = document.createElement("label");
    dateLabel.textContent = "Date on report";
    const date = document.createElement("input");
    date.type = "date";
    date.value = documentRecord.recordDate || "";
    dateLabel.append(date);

    const findingLabel = document.createElement("label");
    findingLabel.textContent = "Key finding / value (optional)";
    const findingInput = document.createElement("input");
    findingInput.type = "text";
    findingInput.placeholder = "e.g. TSH: 1.8 mIU/L, Follicles: 14";
    findingInput.value = documentRecord.keyFinding || "";
    findingLabel.append(findingInput);

    fieldsGrid.append(catLabel, dateLabel, findingLabel);

    const noteLabel = document.createElement("label");
    noteLabel.textContent = "Your note or questions about this report";
    const note = document.createElement("textarea");
    note.value = documentRecord.notes || "";
    note.placeholder =
      "What would you like to remember or discuss with your doctor?";
    noteLabel.append(note);

    const checkContainer = document.createElement("div");
    checkContainer.className = "document-record-checkboxes";

    const timelineLabel = document.createElement("label");
    const timelineCheck = document.createElement("input");
    timelineCheck.type = "checkbox";
    timelineCheck.checked = documentRecord.showOnTimeline !== false;
    timelineLabel.append(
      timelineCheck,
      document.createTextNode("Show on cycle timeline"),
    );

    const summaryLabel = document.createElement("label");
    const summaryCheck = document.createElement("input");
    summaryCheck.type = "checkbox";
    summaryCheck.checked = Boolean(documentRecord.includeInSummary);
    summaryLabel.append(
      summaryCheck,
      document.createTextNode("Include in clinician appointment brief"),
    );

    checkContainer.append(timelineLabel, summaryLabel);

    const actions = document.createElement("div");
    actions.className = "document-actions";

    const extractBtn = document.createElement("button");
    extractBtn.className = "btn soft";
    extractBtn.style.fontSize = "12px";
    extractBtn.style.padding = "5px 11px";
    extractBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px;margin-right:4px"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>Assisted extract`;
    extractBtn.addEventListener("click", () =>
      openReportExtractionModal(documentRecord.id),
    );

    const save = document.createElement("button");
    save.className = "btn";
    save.textContent = "Save changes";
    save.addEventListener("click", () =>
      updateDocument(documentRecord.id, {
        category: catSelect.value,
        recordDate: date.value,
        keyFinding: findingInput.value.trim(),
        notes: note.value.trim(),
        showOnTimeline: timelineCheck.checked,
        includeInSummary: summaryCheck.checked,
      }),
    );

    const download = document.createElement("button");
    download.className = "text-button";
    download.textContent = "Download original";
    download.addEventListener("click", () => downloadDocument(documentRecord));

    const remove = document.createElement("button");
    remove.className = "text-button remove-document";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => removeDocument(documentRecord.id));

    actions.append(extractBtn, save, download, remove);
    article.append(heading, fieldsGrid, noteLabel, checkContainer, actions);
    list.append(article);
  });
}

async function openReportExtractionModal(docId = null, initialText = "") {
  currentExtractionDocId = docId;
  const modal = document.getElementById("extractionModalBackdrop");
  if (!modal) return;

  const titleEl = document.getElementById("extractionModalTitle");
  const textEl = document.getElementById("extractionText");
  const dateEl = document.getElementById("extractionReportDate");
  const catEl = document.getElementById("extractionCategory");
  const reviewSec = document.getElementById("extractionReviewSection");
  const confirmBtn = document.getElementById("confirmExtractionBtn");
  const previewEl = document.getElementById("compiledFindingPreview");
  const dateHintEl = document.getElementById("extractionDateHint");

  if (dateHintEl) dateHintEl.textContent = "";
  if (confirmBtn) confirmBtn.disabled = true;
  candidateFindings = [];

  let textToScan = initialText;

  if (docId) {
    const doc = documents.find((d) => d.id === docId);
    if (doc) {
      titleEl.textContent = `Review Report: ${doc.name}`;
      if (dateEl) dateEl.value = doc.recordDate || "";
      if (catEl) catEl.value = doc.category || "Blood / Hormone panel";
      if (previewEl) previewEl.value = doc.keyFinding || "";
      if (
        !textToScan &&
        (doc.mime.includes("text") || doc.name.endsWith(".txt"))
      ) {
        try {
          const stored = await getDocument(docId);
          if (stored && stored.blob) {
            textToScan = await stored.blob.text();
          }
        } catch (err) {
          console.warn("Could not read stored blob text:", err);
        }
      }
    }
  } else {
    titleEl.textContent = "Assisted Medical Report Key-Finding Scan";
    if (dateEl) dateEl.value = "";
    if (catEl) catEl.value = "Blood / Hormone panel";
    if (previewEl) previewEl.value = "";
  }

  if (textEl) textEl.value = textToScan;
  modal.classList.add("show");

  if (textToScan && textToScan.trim()) {
    runExtractionScan();
  } else {
    if (reviewSec) reviewSec.style.display = "none";
  }
}

function closeExtractionModal() {
  const modal = document.getElementById("extractionModalBackdrop");
  if (modal) modal.classList.remove("show");
  currentExtractionDocId = null;
  candidateFindings = [];
}

function loadSampleReport(type) {
  const textEl = document.getElementById("extractionText");
  if (!textEl) return;
  if (type === "hormone") {
    textEl.value = SAMPLE_HORMONE_REPORT;
  } else if (type === "ultrasound") {
    textEl.value = SAMPLE_ULTRASOUND_REPORT;
  }
  runExtractionScan();
}

function runExtractionScan() {
  const text = (document.getElementById("extractionText")?.value || "").trim();
  if (!text) {
    toast("Please enter or paste report text first");
    return;
  }

  const res = extractReportDetails(text);
  const dateEl = document.getElementById("extractionReportDate");
  const catEl = document.getElementById("extractionCategory");
  const dateHintEl = document.getElementById("extractionDateHint");
  const reviewSec = document.getElementById("extractionReviewSection");

  if (res.date && dateEl && !dateEl.value) {
    dateEl.value = res.date;
  }
  if (dateHintEl) {
    dateHintEl.textContent = res.dateSnippet
      ? `Found in report: "${res.dateSnippet}"`
      : "";
  }
  if (catEl && res.category) {
    catEl.value = res.category;
  }

  candidateFindings = res.findings.map((f) => ({
    id: f.id,
    metric: f.metric,
    value: f.value,
    unit: f.unit,
    range: f.range,
    formatted: f.formatted,
    type: f.type,
    checked: true,
  }));

  if (reviewSec) reviewSec.style.display = "block";
  renderCandidateFindingsList();

  if (res.findings.length) {
    toast(
      `Recognized ${res.findings.length} candidate measurement${res.findings.length === 1 ? "" : "s"}. Review before saving.`,
    );
  } else {
    toast(
      "No standard hormone or ultrasound measurements detected in text. You can add findings manually or check date.",
    );
  }
}

function renderCandidateFindingsList() {
  const container = document.getElementById("candidateFindingsList");
  if (!container) return;
  if (!candidateFindings.length) {
    container.innerHTML =
      '<p class="empty-state" style="padding:10px;font-size:12px">No findings in review list. Click "＋ Add custom finding" to add one.</p>';
    updateCompiledFindingPreview();
    return;
  }
  container.innerHTML = candidateFindings
    .map(
      (item, idx) => `
    <div class="candidate-finding-item ${item.checked ? "included" : "excluded"}" data-index="${idx}">
      <input type="checkbox" id="cfind_${idx}" ${item.checked ? "checked" : ""} onchange="toggleFindingItem(${idx})" aria-label="Include ${escapeHTML(item.metric)}">
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;flex-wrap:wrap">
          <strong style="font-size:12px;color:var(--ink)">${escapeHTML(item.metric)}</strong>
          ${item.range ? `<span class="tag info" style="font-size:10px;padding:1px 6px">ref: ${escapeHTML(item.range)}</span>` : ""}
          <span class="tag" style="font-size:10px;padding:1px 6px;text-transform:capitalize">${escapeHTML(item.type || "finding")}</span>
        </div>
        <input type="text" class="candidate-edit-input" value="${escapeHTML(item.formatted)}" oninput="updateFindingItemText(${idx}, this.value)" placeholder="Metric formatted text">
      </div>
      <button type="button" class="text-button remove-document" onclick="removeFindingItem(${idx})" title="Remove item" style="font-size:16px;padding:2px 6px">×</button>
    </div>
  `,
    )
    .join("");
  updateCompiledFindingPreview();
}

function toggleFindingItem(index) {
  if (candidateFindings[index]) {
    candidateFindings[index].checked = !candidateFindings[index].checked;
    renderCandidateFindingsList();
  }
}

function updateFindingItemText(index, text) {
  if (candidateFindings[index]) {
    candidateFindings[index].formatted = text;
    updateCompiledFindingPreview();
  }
}

function removeFindingItem(index) {
  candidateFindings.splice(index, 1);
  renderCandidateFindingsList();
}

function addManualFindingItem() {
  const metric = prompt(
    "Enter metric or assay name (e.g. Vitamin D, Fasting Glucose):",
  );
  if (!metric || !metric.trim()) return;
  const value = prompt(
    `Enter finding or value for ${metric.trim()} (e.g. 32 ng/mL):`,
  );
  if (!value || !value.trim()) return;
  const formatted = `${metric.trim()}: ${value.trim()}`;
  candidateFindings.push({
    id: "custom_" + Date.now(),
    metric: metric.trim(),
    value: value.trim(),
    unit: "",
    range: null,
    formatted,
    type: "custom",
    checked: true,
  });
  renderCandidateFindingsList();
}

function updateCompiledFindingPreview() {
  const preview = document.getElementById("compiledFindingPreview");
  const confirmBtn = document.getElementById("confirmExtractionBtn");
  if (!preview) return;
  const activeFindings = candidateFindings.filter(
    (f) => f.checked && f.formatted && f.formatted.trim(),
  );
  const compiled = activeFindings.map((f) => f.formatted.trim()).join(" · ");
  preview.value = compiled;
  if (confirmBtn) {
    const hasDate = Boolean(
      document.getElementById("extractionReportDate")?.value,
    );
    confirmBtn.disabled = !compiled && !hasDate;
  }
}

async function confirmAndApplyExtraction() {
  const reportDate =
    document.getElementById("extractionReportDate")?.value || "";
  const category =
    document.getElementById("extractionCategory")?.value ||
    "Blood / Hormone panel";
  const keyFinding = (
    document.getElementById("compiledFindingPreview")?.value || ""
  ).trim();
  const confirmedFindings = candidateFindings.filter((f) => f.checked);

  if (currentExtractionDocId) {
    await updateDocument(currentExtractionDocId, {
      recordDate: reportDate,
      category,
      keyFinding,
      extractionConfirmed: true,
      extractedFindings: confirmedFindings,
    });
  } else {
    const docId = newID();
    const docName = `${category === "Pelvic / Follicle Ultrasound" ? "Ultrasound Report" : "Hormone Panel Lab Report"} (${reportDate ? formatDate(reportDate) : "Dated"})`;
    const textLength =
      (document.getElementById("extractionText")?.value || "").length || 1024;
    await putDocument({
      id: docId,
      name: docName,
      mime: "text/plain",
      size: textLength,
      uploadedAt: localISODate(),
      recordDate: reportDate,
      category,
      keyFinding,
      notes: "Reviewed and confirmed from assisted report extraction.",
      includeInSummary: true,
      showOnTimeline: true,
      extractionConfirmed: true,
      extractedFindings: confirmedFindings,
    });
    await loadDocuments();
  }

  closeExtractionModal();
  toast("Extracted report values confirmed and saved to record");
}

async function updateDocument(id, changes) {
  invalidateAppCaches();
  const documentRecord = documents.find((item) => item.id === id);
  if (!documentRecord) return;
  Object.assign(documentRecord, changes);
  await putDocument({ ...documentRecord, ...changes });
  documents = documents.map((item) => (item.id === id ? documentRecord : item));
  renderDocuments();
  renderTimelineOnly();
  renderClinicianBrief();
  toast("Document record saved on this device");
}

async function downloadDocumentById(id) {
  const documentRecord = documents.find((item) => item.id === id);
  if (documentRecord) await downloadDocument(documentRecord);
}

async function downloadDocument(documentRecord) {
  const storedDocument = await getDocument(documentRecord.id);
  const url = URL.createObjectURL(storedDocument.blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = documentRecord.name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function removeDocument(id) {
  if (!confirm("Remove this document and its notes from this device?")) return;
  const db = await openDocumentDatabase();
  await new Promise((resolve, reject) => {
    const transaction = db.transaction(
      [DOCUMENT_STORE, DOCUMENT_FILE_STORE],
      "readwrite",
    );
    transaction.objectStore(DOCUMENT_STORE).delete(id);
    transaction.objectStore(DOCUMENT_FILE_STORE).delete(id);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
  await loadDocuments();
}

async function resetData() {
  if (
    !confirm(
      "Clear your entries and documents from this device and restore the sample timeline?",
    )
  )
    return;
  invalidateAppCaches();
  DATE_FORMAT_CACHE.clear();
  localStorage.removeItem(ENTRY_KEY);
  localStorage.removeItem(VOICE_KEY);
  localStorage.removeItem(MEDICATIONS_KEY);
  localStorage.removeItem(PRINT_PREFS_KEY);
  entries = SAMPLE_ENTRIES.slice();
  voiceNotes = [];
  medications = SAMPLE_MEDICATIONS.slice();
  printPrefs = {
    ...DEFAULT_PRINT_PREFS,
    sections: { ...DEFAULT_PRINT_PREFS.sections },
  };
  persistMedications();
  persistPrintPrefs();
  const db = await openDocumentDatabase();
  await new Promise((resolve, reject) => {
    const transaction = db.transaction(
      [DOCUMENT_STORE, DOCUMENT_FILE_STORE],
      "readwrite",
    );
    transaction.objectStore(DOCUMENT_STORE).clear();
    transaction.objectStore(DOCUMENT_FILE_STORE).clear();
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
  await loadDocuments();
  render();
  toast("Sample timeline restored");
}

function initialize() {
  migrateOldVoiceEntries();
  render();
  loadDocuments().then(generateSummary);
}

function migrateOldVoiceEntries() {
  const oldNotes = entries.filter((entry) => entry.type === "voice");
  if (!oldNotes.length) return;
  voiceNotes = [
    ...oldNotes.map((entry) => ({
      id: entry.id || newID(),
      date: entry.date,
      text: entry.detail || entry.title,
    })),
    ...voiceNotes,
  ];
  entries = entries.filter((entry) => entry.type !== "voice");
  persistVoiceNotes();
  persistEntries();
}

async function exportDataBackup() {
  try {
    const db = await openDocumentDatabase();
    const docRecords = await new Promise((resolve, reject) => {
      const tx = db.transaction([DOCUMENT_STORE], "readonly");
      const req = tx.objectStore(DOCUMENT_STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });

    const docFiles = await new Promise((resolve, reject) => {
      const tx = db.transaction([DOCUMENT_FILE_STORE], "readonly");
      const req = tx.objectStore(DOCUMENT_FILE_STORE).openCursor();
      const filesMap = {};
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          filesMap[cursor.key] = cursor.value;
          cursor.continue();
        } else {
          resolve(filesMap);
        }
      };
      req.onerror = () => reject(req.error);
    });

    const serializableDocs = [];
    for (const doc of docRecords) {
      const fileData = docFiles[doc.id];
      let base64 = null;
      if (fileData) {
        base64 = await new Promise((res) => {
          const reader = new FileReader();
          reader.onload = () => res(reader.result);
          reader.onerror = () => res(null);
          reader.readAsDataURL(fileData);
        });
      }
      serializableDocs.push({ metadata: doc, fileData: base64 });
    }

    const backupPayload = {
      appName: "Cycle Context",
      schemaVersion: CURRENT_SCHEMA_VERSION,
      exportDate: new Date().toISOString(),
      entries,
      voiceNotes,
      medications,
      customQuestions,
      disabledQuestionIds: Array.from(disabledQuestionIds),
      printPrefs,
      documents: serializableDocs,
    };

    const blob = new Blob([JSON.stringify(backupPayload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cycle-context-backup-${localISODate()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toast("Backup downloaded successfully");
  } catch (err) {
    console.error("Backup export failed:", err);
    alert("Failed to generate backup: " + err.message);
  }
}

async function importDataBackup(input) {
  const file = input.files?.[0];
  if (!file) return;

  try {
    const text = await file.text();
    const data = JSON.parse(text);

    if (!data.appName && !Array.isArray(data.entries)) {
      throw new Error("Unrecognized backup format.");
    }

    if (
      !confirm(
        `Restore backup from ${formatDate(data.exportDate?.slice(0, 10) || localISODate())}? This will merge and update your records on this device.`,
      )
    ) {
      input.value = "";
      return;
    }

    if (Array.isArray(data.entries)) {
      entries = data.entries.map((e) => ({
        schemaVersion: CURRENT_SCHEMA_VERSION,
        ...e,
      }));
      persistEntries();
    }
    if (Array.isArray(data.voiceNotes)) {
      voiceNotes = data.voiceNotes;
      persistVoiceNotes();
    }
    if (Array.isArray(data.medications)) {
      medications = data.medications;
      persistMedications();
    }
    if (Array.isArray(data.customQuestions)) {
      customQuestions = data.customQuestions;
      persistCustomQuestions();
    }
    if (Array.isArray(data.disabledQuestionIds)) {
      disabledQuestionIds = new Set(data.disabledQuestionIds);
      persistDisabledQuestions();
    }
    if (data.printPrefs && typeof data.printPrefs === "object") {
      printPrefs = { ...DEFAULT_PRINT_PREFS, ...data.printPrefs };
      if (!printPrefs.sections)
        printPrefs.sections = { ...DEFAULT_PRINT_PREFS.sections };
      persistPrintPrefs();
    }

    if (Array.isArray(data.documents) && data.documents.length) {
      const db = await openDocumentDatabase();
      for (const item of data.documents) {
        const meta = item.metadata;
        if (!meta || !meta.id) continue;
        await new Promise((res, rej) => {
          const tx = db.transaction([DOCUMENT_STORE], "readwrite");
          tx.objectStore(DOCUMENT_STORE).put(meta);
          tx.oncomplete = res;
          tx.onerror = rej;
        });

        if (item.fileData) {
          const res = await fetch(item.fileData);
          const blob = await res.blob();
          await new Promise((res2, rej2) => {
            const tx2 = db.transaction([DOCUMENT_FILE_STORE], "readwrite");
            tx2.objectStore(DOCUMENT_FILE_STORE).put(blob, meta.id);
            tx2.oncomplete = res2;
            tx2.onerror = rej2;
          });
        }
      }
      await loadDocuments();
    }

    render();
    generateSummary();
    toast("Backup restored successfully");
  } catch (err) {
    console.error("Backup import error:", err);
    alert("Failed to restore backup: " + err.message);
  } finally {
    input.value = "";
  }
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
  removeDocument,
  setSummaryRange,
  applyCustomSummaryDates,
  clearCustomSummaryDates,
  toggleQuestion,
  addCustomQuestion,
  removeCustomQuestion,
  exportDataBackup,
  importDataBackup,
  openReportExtractionModal,
  closeExtractionModal,
  loadSampleReport,
  runExtractionScan,
  renderCandidateFindingsList,
  toggleFindingItem,
  updateFindingItemText,
  removeFindingItem,
  addManualFindingItem,
  updateCompiledFindingPreview,
  confirmAndApplyExtraction,
  openMedicationModal,
  closeMedicationModal,
  saveMedication,
  deleteMedication,
  toggleMedicationStatus,
  toggleMedicationSummaryInclusion,
  handleMedStatusChange,
  applyMedPreset,
  togglePrintSection,
  toggleCompactPrint,
  updatePrintMeta,
  setSymptomPhaseFilter,
});

initialize();
