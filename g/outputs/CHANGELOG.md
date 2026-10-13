
# Rules changelog

## 0.4.0
- Added Assisted Medical Report Key-Finding Extraction.
  - Client-side, local-first privacy: 100% on-device parsing of uploaded text/lab reports and pasted notes without sending any private medical records to external cloud servers.
  - Structured extraction of core hormone panels & assays: TSH, Free T4, Total Testosterone, Free Testosterone, DHEA-S, AMH, Estradiol (E2), FSH, LH, automated LH:FSH ratio calculation, Prolactin, Progesterone, Fasting Insulin, HbA1c, and Ferritin with units and reference intervals.
  - Structured extraction of pelvic & follicle ultrasound findings: Endometrial thickness (mm), Antral Follicle Count (total AFC and per-ovary counts), Ovarian volumes (cm³ / mL), and imaging morphological features (PCOM, trilaminar endometrium).
  - Mandatory Patient Review & Verification Flow: Candidate metrics and dates are presented in an interactive review modal allowing selective inclusion, inline adjustments, and manual custom finding additions before saving.
  - Transparent Evidence Labels & Provenance: Confirmed values are explicitly tagged across the UI as `<span class="tag lab-tag">Extracted from report (confirmed by you)</span>` on document cards, the synchronized cycle timeline, and the clinician consultation brief.
  - Diagnostic Safeguard: Does not perform automated disease diagnosis, algorithmic risk scoring, or treatment recommendations; preserves objective laboratory values and patient autonomy.
  - Automated `.txt` document detection: Reads plain-text reports upon upload and automatically launches the review scanner.

## 0.3.0
- Added Clinician Consultation Toolkit & Data Portability.
  - Appointment timeframe observation filtering: Preset chips (All time, 3 months, 6 months, 12 months) and custom date-range selector to filter periods, cycle metrics, symptoms, and documents for clinic visits.
  - Interactive Doctor Discussion Agenda Builder: Auto-suggested and custom question checklist with add/remove capabilities, persistent local storage, and exclusion toggle for print/copy.
  - Complete JSON Data Portability: One-click private JSON backup export and restoration including cycle entries, voice notes, document metadata/files, and discussion agendas.
  - Print/PDF layout optimizations for clean, clinical consultation brief exports.

## 0.2.0
- Added Population Comparison & Benchmark Layer (Bull et al., 2019; npj Digital Medicine).
  - Source: Bull JR, Rowland SP, Scherwitzl EB, et al. *Real-world menstrual cycle characteristics of more than 600,000 menstrual cycles*. npj Digit. Med. 2, 83 (2019). Marked `verify: true`.
  - Sample size: 612,613 cycles across 124,648 individuals.
  - Population median: 29.0 days, mean: 29.3 days (SD 5.2).
  - Middle 50% interquartile range (IQR): 27–31 days.
  - Middle 90% (5th–95th percentile): 23–38 days.
  - Individual cycle variation context: Typical within-person variation is 2–4 days (median 2.5); variation >9 days occurs in <10% of users.
  - Provides non-judgmental, purely statistical population distribution context alongside the patient's personal baseline.

## 0.1.0
- Initial thresholds (FIGO 2018-based). All marked `verify: true`; confirm against source before release.
  - Cycle length: 24–38 days (frequency)
  - Cycle variation: max 9 days spread between shortest and longest cycle in window (regularity)
  - Bleeding duration: max 8 days (duration)
  - Gap since last start: max 90 days (~3 months)

# Parser Benchmark Log

## Parser v0.1.0 (Extraction Engine)
- Date reference: `2026-10-05` (pinned Monday convention)
- Evaluation harness: `evaluate-extraction.js`
- Test corpus: `dataset.json` (54 dev cases, 39 untouched test cases)
- Results:
  - **Dev Split (54 cases)**:
    - Overall: Precision 1.00, Recall 1.00, **F1: 1.00**
    - Period-start F1: 1.00
    - Period-end F1: 1.00
    - Symptom F1: 1.00
    - Date errors: 0
    - Negation false positives: 0/13
  - **Test Split (39 cases — single untouched run)**:
    - Overall: Precision 0.92, Recall 0.90, **F1: 0.91**
    - Period-start F1: 0.94
    - Period-end F1: 1.00
    - Symptom F1: 0.86
    - Date errors: 0 off-by-1, 0 off-by-7, 2 other
    - Negation false positives: 0/13
- General mechanisms implemented:
  - Clause-level event-to-date binding (prevents date bleed in multi-event sentences)
  - Longest-match symptom subsumption (suppresses generic terms like "pain" inside "back pain")
  - Clause-scoped negation with conjunction coordination ("no headaches or cramps")
  - Disfluency and self-correction retraction ("Wednesday, actually no, Thursday")

