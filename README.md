# Cycle Context — Your Health, in Context

> A privacy-first, local-only cycle tracking and clinical communication tool designed to empower patients with objective context, FIGO-compliant metrics, and appointment-ready clinician briefs.

---

## 📁 Repository Structure

The project follows a standard, modular directory architecture:

```text
Cycle-context/
├── src/                          # Web application source
│   ├── index.html                # Formatted, semantic HTML UI entrypoint
│   ├── app.js                    # UI orchestrator and state management
│   ├── config/                   # Clinical thresholds & configuration
│   │   └── rules.config.js       # FIGO normal boundaries, thresholds, and clinical copy
│   ├── modules/                  # Specialized business logic & analytical engines
│   │   ├── analysis.js           # Cycle calculations, FIGO flags, population stats
│   │   ├── brief-visuals.js      # Executive summary engine, SVG sparkline generator
│   │   ├── extraction.js         # Voice check-in NLP parser (dates, symptoms, periods)
│   │   ├── medications.js        # Active regimen tracking, durations, presets
│   │   ├── report-extraction.js  # Assisted lab scan (hormones, ultrasound metrics)
│   │   └── symptom-correlation.js# Catamenial phase mapping & cycle matrix
│   └── styles/
│       └── styles.css            # Responsive styles, dark/light themes, print layout
│
├── tests/                        # Automated unit tests (Node.js test runner)
│   ├── analysis.test.js          # Tests for cycle statistics & population bands
│   ├── brief-visuals.test.js     # Tests for SVG sparklines & executive brief data
│   ├── medications.test.js       # Tests for regimen calculations & filters
│   ├── report-extraction.test.js # Tests for hormone & ultrasound parsers
│   ├── speech-variant.test.js    # Tests for speech text normalization
│   └── symptom-correlation.test.js # Tests for catamenial phase recurrence
│
├── benchmarks/                   # NLP evaluation & benchmark suite
│   ├── adapter.js                # Test adapter wrapping extraction engine
│   ├── dataset.json              # 54 labeled clinical & conversational test cases
│   ├── evaluate-extraction.js    # Evaluation runner (precision, recall, F1)
│   └── speech-variant.js         # Speech transcript normalizer
│
├── docs/                         # Specifications & historical documentation
│   ├── product-brief.md          # Core clinical principles & non-causal UX thesis
│   └── CHANGELOG.md              # Version history & release notes
│
├── package.json                  # Project manifest, dependencies & NPM scripts
└── README.md                     # Project documentation
```

---

## 🚀 Quick Start

### 1. Run the Web Application
Start a local static HTTP server (zero cloud dependencies):
```bash
npm start
# Opens local server on port 8089 serving the `src/` directory:
# http://localhost:8089/
```

### 2. Run the Unit Test Suite
Execute all 42 automated unit tests:
```bash
npm test
```

### 3. Run the NLP Extraction Benchmarks
Evaluate the voice & text extraction engine against labeled test datasets:
```bash
npm run bench
```
*(Evaluates precision, recall, F1 score across period start, period end, and symptom extraction).*

---

## 🩺 Core Design Principles

1. **Local-First & Private by Default**:
   All cycle entries, personal notes, medication regimens, and medical reports remain strictly stored in local browser storage (`IndexedDB` & `localStorage`). No trackers, external telemetry, or unvetted cloud dependencies.

2. **FIGO-Compliant Nomenclature**:
   Adheres strictly to the **International Federation of Gynecology and Obstetrics (FIGO)** standards for normal cycle frequency (24–38 days) and variation (< 7–9 days).

3. **Objective, Non-Causal Phrasing**:
   Cycle Context deliberately describes *what was logged*, rather than asserting causality or automated medical diagnoses (e.g., *"3 of 4 cycles have recorded bloating in the pre-menstrual phase"* vs *"Your cramps are caused by PMS"*).

4. **Clinician-Ready Consultation Brief**:
   Generates a one-page printable or copyable clinical brief with cycle trend sparklines, active medications, key lab values, and personalized patient agenda items.
