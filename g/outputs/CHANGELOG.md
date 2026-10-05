
# Rules changelog

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

