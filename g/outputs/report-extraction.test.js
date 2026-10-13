import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractReportDate,
  extractReportDetails,
  detectReportCategory,
  extractUltrasoundObservations
} from './report-extraction.js';

test('extractReportDate: captures dates with prefixes and ISO format', () => {
  const t1 = 'Collection Date: 14 Oct 2024\nPatient Name: Jane Doe';
  const r1 = extractReportDate(t1);
  assert.equal(r1.date, '2024-10-14');
  assert.equal(r1.confidence, 'high');

  const t2 = 'Date of Exam: 2024-09-18\nUltrasound Pelvis';
  const r2 = extractReportDate(t2);
  assert.equal(r2.date, '2024-09-18');

  const t3 = 'Report Date: October 5, 2024';
  const r3 = extractReportDate(t3);
  assert.equal(r3.date, '2024-10-05');

  const t4 = 'Specimen: Serum on 22/08/2024';
  const r4 = extractReportDate(t4);
  assert.equal(r4.date, '2024-08-22');
});

test('extractReportDetails: extracts comprehensive hormone panel and computes LH:FSH ratio', () => {
  const reportText = `
PATIENT LAB REPORT
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
Ferritin                           42        ng/mL       (15 - 150)
`;

  const res = extractReportDetails(reportText);

  assert.equal(res.success, true);
  assert.equal(res.date, '2024-10-14');
  assert.equal(res.category, 'Blood / Hormone panel');

  // Verify individual findings
  const tsh = res.findings.find(f => f.id === 'tsh');
  assert.ok(tsh);
  assert.equal(tsh.value, '2.45');
  assert.equal(tsh.unit, 'mIU/L');
  assert.equal(tsh.range, '0.40–4.20');

  const tt = res.findings.find(f => f.id === 'total_testosterone');
  assert.ok(tt);
  assert.equal(tt.value, '54');
  assert.equal(tt.unit, 'ng/dL');
  assert.equal(tt.range, '15–70');

  const amh = res.findings.find(f => f.id === 'amh');
  assert.ok(amh);
  assert.equal(amh.value, '5.8');
  assert.equal(amh.unit, 'ng/mL');

  const lh = res.findings.find(f => f.id === 'lh');
  assert.ok(lh);
  assert.equal(lh.value, '12.8');

  const fsh = res.findings.find(f => f.id === 'fsh');
  assert.ok(fsh);
  assert.equal(fsh.value, '5.6');

  // Verify LH:FSH ratio calculation
  const ratio = res.findings.find(f => f.id === 'lh_fsh_ratio');
  assert.ok(ratio);
  assert.equal(ratio.value, '2.29'); // 12.8 / 5.6 = 2.2857 -> 2.29

  const insulin = res.findings.find(f => f.id === 'fasting_insulin');
  assert.ok(insulin);
  assert.equal(insulin.value, '9.2');

  const hba1c = res.findings.find(f => f.id === 'hba1c');
  assert.ok(hba1c);
  assert.equal(hba1c.value, '5.3');
  assert.equal(hba1c.unit, '%');

  assert.ok(res.summaryString.includes('TSH: 2.45 mIU/L'));
  assert.ok(res.summaryString.includes('AMH: 5.8 ng/mL'));
});

test('extractReportDetails: extracts pelvic ultrasound metrics and imaging observations', () => {
  const usText = `
PELVIC ULTRASOUND REPORT
Date of Exam: 2024-09-18
Indication: Irregular menstrual cycles, rule out PCOS.

FINDINGS:
Endometrial thickness: 6.8 mm, regular, trilaminar appearance.
Right Ovary: Volume 8.6 cm3. Antral follicle count: 14 follicles measuring 2-8 mm in peripheral distribution.
Left Ovary: Volume 9.2 cm3. Antral follicle count: 16 follicles in peripheral distribution.
Total AFC: 30 follicles.
Free fluid: None in the pouch of Douglas.

IMPRESSION:
Features compatible with polycystic ovarian morphology (PCOM) based on bilateral elevated follicle count.
`;

  const res = extractReportDetails(usText);

  assert.equal(res.success, true);
  assert.equal(res.date, '2024-09-18');
  assert.equal(res.category, 'Pelvic / Follicle Ultrasound');

  const et = res.findings.find(f => f.id === 'endometrial_thickness');
  assert.ok(et);
  assert.equal(et.value, '6.8');
  assert.equal(et.unit, 'mm');

  const afcTotal = res.findings.find(f => f.id === 'afc_total');
  assert.ok(afcTotal);
  assert.equal(afcTotal.value, '30');

  const rightVol = res.findings.find(f => f.id === 'right_ovary_volume');
  assert.ok(rightVol);
  assert.equal(rightVol.value, '8.6');

  const leftVol = res.findings.find(f => f.id === 'left_ovary_volume');
  assert.ok(leftVol);
  assert.equal(leftVol.value, '9.2');

  const pcom = res.findings.find(f => f.metric === 'Ultrasound Morphology');
  assert.ok(pcom);
  assert.ok(pcom.value.includes('PCOM'));

  const trilaminar = res.findings.find(f => f.metric === 'Endometrial Pattern');
  assert.ok(trilaminar);
});

test('extractReportDetails: graceful handling of empty or unparseable input', () => {
  const empty = extractReportDetails('');
  assert.equal(empty.success, false);
  assert.equal(empty.findings.length, 0);

  const nonMedical = extractReportDetails('Meeting with landlord regarding apartment lease agreement on 2024-01-15.');
  assert.equal(nonMedical.success, false);
  assert.equal(nonMedical.findings.length, 0);
  assert.equal(nonMedical.date, '2024-01-15');
});
