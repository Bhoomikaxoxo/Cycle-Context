/**
 * Client-Side Assisted Medical Report Key-Finding Extraction
 * 
 * Local-first parser for hormone blood panels and pelvic/follicle ultrasound reports.
 * 100% client-side: zero third-party cloud data transfer, preserving full privacy.
 * 
 * Strictly adheres to clinical product principles:
 * - Extracts structured metrics, units, and reference intervals without making diagnoses.
 * - Always pairs with explicit user review and verification before saving to records.
 * - Categorizes findings with transparent provenance tags.
 */

// Common month abbreviations to month index (1-12)
const MONTH_MAP = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12
};

/**
 * Format a Date object into YYYY-MM-DD
 */
export function formatISODate(year, month, day) {
  const y = String(year);
  const m = String(month).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Extract the most plausible report date from text
 */
export function extractReportDate(text) {
  if (!text || typeof text !== 'string') return null;

  // 1. Look for explicit date prefixes (e.g., "Report Date: 14 Oct 2024", "Date of Exam: 2024-09-18")
  const prefixRegex = /(?:report\s*date|collection\s*date|exam\s*date|date\s*of\s*exam|sample\s*date|test\s*date|specimen\s*date|date)[:\s]+([^\r\n,;]+)/i;
  const prefixMatch = text.match(prefixRegex);
  if (prefixMatch) {
    const parsed = parseDateString(prefixMatch[1]);
    if (parsed) return { date: parsed, confidence: 'high', raw: prefixMatch[0].trim() };
  }

  // 2. Look for ISO dates YYYY-MM-DD
  const isoRegex = /\b(20\d{2})[-/](0[1-9]|1[0-2])[-/](0[1-9]|[12]\d|3[01])\b/;
  const isoMatch = text.match(isoRegex);
  if (isoMatch) {
    return {
      date: formatISODate(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3])),
      confidence: 'medium',
      raw: isoMatch[0]
    };
  }

  // 3. Look for named month patterns (e.g., "14 Oct 2024", "October 14, 2024")
  const namedRegex = /\b(?:(\d{1,2})(?:st|nd|rd|th)?[\s\-_]+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)[\s\-_]+(20\d{2})|(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)[\s\-_]+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(20\d{2})))\b/i;
  const namedMatch = text.match(namedRegex);
  if (namedMatch) {
    if (namedMatch[1]) {
      // 14 Oct 2024
      const day = Number(namedMatch[1]);
      const month = MONTH_MAP[namedMatch[2].toLowerCase().slice(0, 3)];
      const year = Number(namedMatch[3]);
      if (month && day >= 1 && day <= 31) {
        return { date: formatISODate(year, month, day), confidence: 'medium', raw: namedMatch[0] };
      }
    } else if (namedMatch[4]) {
      // October 14, 2024
      const month = MONTH_MAP[namedMatch[4].toLowerCase().slice(0, 3)];
      const day = Number(namedMatch[5]);
      const year = Number(namedMatch[6] || new Date().getFullYear());
      if (month && day >= 1 && day <= 31) {
        return { date: formatISODate(year, month, day), confidence: 'medium', raw: namedMatch[0] };
      }
    }
  }

  // 4. Look for DD/MM/YYYY or MM/DD/YYYY
  const slashRegex = /\b(0?[1-9]|[12]\d|3[01])\/(0?[1-9]|1[0-2])\/(20\d{2})\b/;
  const slashMatch = text.match(slashRegex);
  if (slashMatch) {
    const part1 = Number(slashMatch[1]);
    const part2 = Number(slashMatch[2]);
    const year = Number(slashMatch[3]);
    // If part1 > 12, part1 must be day and part2 month (DD/MM/YYYY)
    if (part1 > 12) {
      return { date: formatISODate(year, part2, part1), confidence: 'medium', raw: slashMatch[0] };
    }
    // Default assumption for ambiguous slash dates: DD/MM/YYYY in clinical reports or MM/DD/YYYY
    return { date: formatISODate(year, part2, part1), confidence: 'low', raw: slashMatch[0] };
  }

  return null;
}

function parseDateString(str) {
  if (!str) return null;
  const clean = str.trim();

  // Try ISO
  const isoMatch = clean.match(/\b(20\d{2})[-/](0[1-9]|1[0-2])[-/](0[1-9]|[12]\d|3[01])\b/);
  if (isoMatch) return formatISODate(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));

  // Try DD Month YYYY or Month DD YYYY
  const namedMatch = clean.match(/\b(?:(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)\s+(20\d{2})|([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(20\d{2}))\b/i);
  if (namedMatch) {
    if (namedMatch[1]) {
      const monthKey = namedMatch[2].toLowerCase().slice(0, 3);
      if (MONTH_MAP[monthKey]) return formatISODate(Number(namedMatch[3]), MONTH_MAP[monthKey], Number(namedMatch[1]));
    } else if (namedMatch[4]) {
      const monthKey = namedMatch[4].toLowerCase().slice(0, 3);
      if (MONTH_MAP[monthKey]) return formatISODate(Number(namedMatch[6]), MONTH_MAP[monthKey], Number(namedMatch[5]));
    }
  }

  return null;
}

/**
 * Common laboratory assays and ultrasound markers definitions with extraction rules
 */
export const CLINICAL_EXTRACTION_DEFINITIONS = [
  // --- Thyroid Panel ---
  {
    id: 'tsh',
    name: 'TSH',
    category: 'Blood / Hormone panel',
    keywords: [
      /thyroid[\s\-_]*stimulating[\s\-_]*hormone/i,
      /\btsh\b/i,
      /\bthyrotropin\b/i
    ],
    valueRegex: /(?:tsh|thyrotropin|thyroid[\s\-_]*stimulating[\s\-_]*hormone)[^0-9\n]{0,35}[:=]?\s*([0-9]+(?:\.[0-9]+)?)\s*(m[iI][uU]\/[lL]|µ[iI][uU]\/[mM][lL]|u[iI][uU]\/[mM][lL]|µ[iI][uU]\/[lL]|u[iI][uU]\/[lL])?/i,
    rangeRegex: /(?:ref(?:erence)?(?:\s*range|\s*interval)?|normal)?[^0-9\n]{0,15}\(?\s*([0-9]+(?:\.[0-9]+)?)\s*[-–—to]+\s*([0-9]+(?:\.[0-9]+)?)\s*\)?/i,
    defaultUnit: 'mIU/L',
    type: 'hormone'
  },
  {
    id: 'free_t4',
    name: 'Free T4',
    category: 'Blood / Hormone panel',
    keywords: [/\bfree[\s\-_]*t4\b/i, /\bft4\b/i, /\bthyroxine[\s,]*free\b/i],
    valueRegex: /(?:free[\s\-_]*t4|ft4|thyroxine[\s,]*free)[^0-9\n]{0,35}[:=]?\s*([0-9]+(?:\.[0-9]+)?)\s*(ng\/[dD][lL]|pmol\/[lL])?/i,
    defaultUnit: 'ng/dL',
    type: 'hormone'
  },

  // --- Androgens & PCOS-relevant markers ---
  {
    id: 'total_testosterone',
    name: 'Total Testosterone',
    category: 'Blood / Hormone panel',
    keywords: [
      /total[\s\-_]*testosterone/i,
      /testosterone[\s,]*total/i,
      /serum[\s\-_]*testosterone/i,
      /\btestosterone\b(?![\s\-_]*free)/i
    ],
    valueRegex: /(?:total[\s\-_]*testosterone|testosterone[\s,]*total|serum[\s\-_]*testosterone|\btestosterone\b)[^0-9\n]{0,35}[:=]?\s*([0-9]+(?:\.[0-9]+)?)\s*(ng\/[dD][lL]|nmol\/[lL]|ng\/[mM][lL])?/i,
    defaultUnit: 'ng/dL',
    type: 'hormone'
  },
  {
    id: 'free_testosterone',
    name: 'Free Testosterone',
    category: 'Blood / Hormone panel',
    keywords: [
      /free[\s\-_]*testosterone/i,
      /testosterone[\s,]*free/i
    ],
    valueRegex: /(?:free[\s\-_]*testosterone|testosterone[\s,]*free)[^0-9\n]{0,35}[:=]?\s*([0-9]+(?:\.[0-9]+)?)\s*(pg\/[mM][lL]|pmol\/[lL]|ng\/[dD][lL])?/i,
    defaultUnit: 'pg/mL',
    type: 'hormone'
  },
  {
    id: 'dhea_s',
    name: 'DHEA-S',
    category: 'Blood / Hormone panel',
    keywords: [
      /\bdhea[\s\-_]*s\b/i,
      /\bdhea[\s\-_]*sulfate\b/i,
      /dehydroepiandrosterone[\s\-_]*sulfate/i
    ],
    valueRegex: /(?:dhea[\s\-_]*s|dhea[\s\-_]*sulfate|dehydroepiandrosterone[\s\-_]*sulfate)[^0-9\n]{0,35}[:=]?\s*([0-9]+(?:\.[0-9]+)?)\s*(µg\/[dD][lL]|ug\/[dD][lL]|umol\/[lL]|µmol\/[lL])?/i,
    defaultUnit: 'µg/dL',
    type: 'hormone'
  },
  {
    id: 'amh',
    name: 'AMH',
    category: 'Blood / Hormone panel',
    keywords: [
      /\bamh\b/i,
      /anti[\s\-_]*m[uü]llerian[\s\-_]*hormone/i
    ],
    valueRegex: /(?:amh|anti[\s\-_]*m[uü]llerian[\s\-_]*hormone)[^0-9\n]{0,35}[:=]?\s*([0-9]+(?:\.[0-9]+)?)\s*(ng\/[mM][lL]|pmol\/[lL]|µg\/[lL])?/i,
    defaultUnit: 'ng/mL',
    type: 'hormone'
  },

  // --- Reproductive Axis (Estradiol, Progesterone, LH, FSH, Prolactin) ---
  {
    id: 'estradiol',
    name: 'Estradiol (E2)',
    category: 'Blood / Hormone panel',
    keywords: [
      /\bestradiol\b/i,
      /\be2\b/i,
      /17[\s\-_]*beta[\s\-_]*estradiol/i,
      /17[\s\-_]*β[\s\-_]*estradiol/i
    ],
    valueRegex: /(?:estradiol|\be2\b|17[\s\-_]*(?:beta|β)[\s\-_]*estradiol)[^0-9\n]{0,35}[:=]?\s*([0-9]+(?:\.[0-9]+)?)\s*(pg\/[mM][lL]|pmol\/[lL]|ng\/[lL])?/i,
    defaultUnit: 'pg/mL',
    type: 'hormone'
  },
  {
    id: 'fsh',
    name: 'FSH',
    category: 'Blood / Hormone panel',
    keywords: [
      /\bfsh\b/i,
      /follicle[\s\-_]*stimulating[\s\-_]*hormone/i
    ],
    valueRegex: /(?:fsh|follicle[\s\-_]*stimulating[\s\-_]*hormone)[^0-9\n]{0,35}[:=]?\s*([0-9]+(?:\.[0-9]+)?)\s*(m[iI][uU]\/[mM][lL]|[iI][uU]\/[lL])?/i,
    defaultUnit: 'mIU/mL',
    type: 'hormone'
  },
  {
    id: 'lh',
    name: 'LH',
    category: 'Blood / Hormone panel',
    keywords: [
      /\blh\b/i,
      /luteinizing[\s\-_]*hormone/i
    ],
    valueRegex: /(?:lh|luteinizing[\s\-_]*hormone)[^0-9\n]{0,35}[:=]?\s*([0-9]+(?:\.[0-9]+)?)\s*(m[iI][uU]\/[mM][lL]|[iI][uU]\/[lL])?/i,
    defaultUnit: 'mIU/mL',
    type: 'hormone'
  },
  {
    id: 'prolactin',
    name: 'Prolactin',
    category: 'Blood / Hormone panel',
    keywords: [
      /\bprolactin\b/i,
      /\bprl\b/i
    ],
    valueRegex: /(?:prolactin|prl)[^0-9\n]{0,35}[:=]?\s*([0-9]+(?:\.[0-9]+)?)\s*(ng\/[mM][lL]|µg\/[lL]|ug\/[lL]|m[iI][uU]\/[lL])?/i,
    defaultUnit: 'ng/mL',
    type: 'hormone'
  },
  {
    id: 'progesterone',
    name: 'Progesterone',
    category: 'Blood / Hormone panel',
    keywords: [
      /\bprogesterone\b/i,
      /\bp4\b/i
    ],
    valueRegex: /(?:progesterone|\bp4\b)[^0-9\n]{0,35}[:=]?\s*([0-9]+(?:\.[0-9]+)?)\s*(ng\/[mM][lL]|nmol\/[lL])?/i,
    defaultUnit: 'ng/mL',
    type: 'hormone'
  },

  // --- Metabolic & General Cycle Health ---
  {
    id: 'fasting_insulin',
    name: 'Fasting Insulin',
    category: 'Blood / Hormone panel',
    keywords: [
      /fasting[\s\-_]*insulin/i,
      /insulin[\s,]*fasting/i,
      /serum[\s\-_]*insulin/i
    ],
    valueRegex: /(?:fasting[\s\-_]*insulin|insulin[\s,]*fasting|serum[\s\-_]*insulin)[^0-9\n]{0,35}[:=]?\s*([0-9]+(?:\.[0-9]+)?)\s*(µ[iI][uU]\/[mM][lL]|u[iI][uU]\/[mM][lL]|pmol\/[lL])?/i,
    defaultUnit: 'µIU/mL',
    type: 'metabolic'
  },
  {
    id: 'hba1c',
    name: 'HbA1c',
    category: 'Blood / Hormone panel',
    keywords: [
      /\bhba1c\b/i,
      /hemoglobin[\s\-_]*a1c/i,
      /glycated[\s\-_]*hemoglobin/i
    ],
    valueRegex: /(?:hba1c|hemoglobin[\s\-_]*a1c|glycated[\s\-_]*hemoglobin)[^0-9\n]{0,35}[:=]?\s*([0-9]+(?:\.[0-9]+)?)\s*(%|mmol\/mol)?/i,
    defaultUnit: '%',
    type: 'metabolic'
  },
  {
    id: 'ferritin',
    name: 'Ferritin',
    category: 'Blood / Hormone panel',
    keywords: [
      /\bferritin\b/i,
      /serum[\s\-_]*ferritin/i
    ],
    valueRegex: /(?:serum[\s\-_]*ferritin|\bferritin\b)[^0-9\n]{0,35}[:=]?\s*([0-9]+(?:\.[0-9]+)?)\s*(ng\/[mM][lL]|µg\/[lL]|ug\/[lL])?/i,
    defaultUnit: 'ng/mL',
    type: 'metabolic'
  },

  // --- Pelvic & Ultrasound Markers ---
  {
    id: 'endometrial_thickness',
    name: 'Endometrial Thickness',
    category: 'Pelvic / Follicle Ultrasound',
    keywords: [
      /endometrial[\s\-_]*thickness/i,
      /endometrial[\s\-_]*stripe/i,
      /\bendometrium\b/i,
      /\bet[\s:]/i
    ],
    valueRegex: /(?:endometrial[\s\-_]*thickness|endometrial[\s\-_]*stripe|endometrium|\bet\b)[^0-9\n]{0,35}[:=]?\s*([0-9]+(?:\.[0-9]+)?)\s*(mm|cm)?/i,
    defaultUnit: 'mm',
    type: 'ultrasound'
  },
  {
    id: 'afc_total',
    name: 'Total Follicle Count (AFC)',
    category: 'Pelvic / Follicle Ultrasound',
    keywords: [
      /total[\s\-_]*(?:antral[\s\-_]*)?follicle[\s\-_]*count/i,
      /total[\s\-_]*afc/i,
      /afc[\s\-_]*total/i
    ],
    valueRegex: /(?:total[\s\-_]*(?:antral[\s\-_]*)?follicle[\s\-_]*count|total[\s\-_]*afc|afc[\s\-_]*total)[^0-9\n]{0,30}[:=]?\s*([0-9]+)\b/i,
    defaultUnit: 'follicles',
    type: 'ultrasound'
  },
  {
    id: 'right_ovary_follicles',
    name: 'Right Ovary Follicles',
    category: 'Pelvic / Follicle Ultrasound',
    keywords: [
      /right[\s\-_]*ovary[^.\n]*follicle/i,
      /right[\s\-_]*afc/i,
      /afc[\s\-_]*right/i
    ],
    valueRegex: /(?:right[\s\-_]*ovary[^.\n0-9]*|right[\s\-_]*afc|afc[\s\-_]*right)[^0-9\n]{0,25}[:=]?\s*([0-9]+)\s*(?:follicles)?/i,
    defaultUnit: 'follicles',
    type: 'ultrasound'
  },
  {
    id: 'left_ovary_follicles',
    name: 'Left Ovary Follicles',
    category: 'Pelvic / Follicle Ultrasound',
    keywords: [
      /left[\s\-_]*ovary[^.\n]*follicle/i,
      /left[\s\-_]*afc/i,
      /afc[\s\-_]*left/i
    ],
    valueRegex: /(?:left[\s\-_]*ovary[^.\n0-9]*|left[\s\-_]*afc|afc[\s\-_]*left)[^0-9\n]{0,25}[:=]?\s*([0-9]+)\s*(?:follicles)?/i,
    defaultUnit: 'follicles',
    type: 'ultrasound'
  },
  {
    id: 'right_ovary_volume',
    name: 'Right Ovary Volume',
    category: 'Pelvic / Follicle Ultrasound',
    keywords: [
      /right[\s\-_]*ovary[^.\n]*volume/i,
      /right[\s\-_]*ovarian[\s\-_]*volume/i
    ],
    valueRegex: /(?:right[\s\-_]*ovary[^.\n0-9]*volume|right[\s\-_]*ovarian[\s\-_]*volume)[^0-9\n]{0,25}[:=]?\s*([0-9]+(?:\.[0-9]+)?)\s*(cm3|cm³|ml|mL|cc)?/i,
    defaultUnit: 'cm³',
    type: 'ultrasound'
  },
  {
    id: 'left_ovary_volume',
    name: 'Left Ovary Volume',
    category: 'Pelvic / Follicle Ultrasound',
    keywords: [
      /left[\s\-_]*ovary[^.\n]*volume/i,
      /left[\s\-_]*ovarian[\s\-_]*volume/i
    ],
    valueRegex: /(?:left[\s\-_]*ovary[^.\n0-9]*volume|left[\s\-_]*ovarian[\s\-_]*volume)[^0-9\n]{0,25}[:=]?\s*([0-9]+(?:\.[0-9]+)?)\s*(cm3|cm³|ml|mL|cc)?/i,
    defaultUnit: 'cm³',
    type: 'ultrasound'
  }
];

/**
 * Extract reference interval on the same line or immediate context
 */
function extractReferenceInterval(line) {
  if (!line) return null;
  // Match formats like: (0.40 - 4.20), (15 - 70), (Follicular: 3.5 - 12.5), (0.4 to 4.0), 0.4-4.2
  const rangeMatch = line.match(/\(?\b(?:(?:follicular|ref(?:erence)?|normal)[:\s]*)?([0-9]+(?:\.[0-9]+)?)\s*[-–—to]+\s*([0-9]+(?:\.[0-9]+)?)\s*\)?/i);
  if (rangeMatch) {
    const low = rangeMatch[1];
    const high = rangeMatch[2];
    if (low !== high && Number(low) < Number(high)) {
      return `${low}–${high}`;
    }
  }
  return null;
}

/**
 * Determine the most probable category for the report based on text keywords
 */
export function detectReportCategory(text, extractedFindings = []) {
  if (!text) return 'Blood / Hormone panel';

  const lower = text.toLowerCase();
  let ultrasoundScore = 0;
  let bloodScore = 0;

  const usKeywords = ['ultrasound', 'pelvic', 'follicle', 'endometrial', 'endometrium', 'ovary', 'ovarian', 'transvaginal', 'afc', 'uterus', 'pcom'];
  const bloodKeywords = ['serum', 'blood', 'hormone', 'tsh', 'testosterone', 'estradiol', 'prolactin', 'amh', 'fsh', 'lh', 'progesterone', 'fasting insulin', 'hba1c', 'ferritin'];

  usKeywords.forEach(kw => {
    if (lower.includes(kw)) ultrasoundScore++;
  });
  bloodKeywords.forEach(kw => {
    if (lower.includes(kw)) bloodScore++;
  });

  extractedFindings.forEach(f => {
    if (f.type === 'ultrasound') ultrasoundScore += 2;
    if (f.type === 'hormone' || f.type === 'metabolic') bloodScore += 2;
  });

  if (ultrasoundScore > bloodScore && ultrasoundScore > 0) {
    return 'Pelvic / Follicle Ultrasound';
  }
  return 'Blood / Hormone panel';
}

/**
 * Extract qualitative ultrasound observations (e.g., PCOM, trilaminar pattern)
 */
export function extractUltrasoundObservations(text) {
  const observations = [];
  if (!text) return observations;

  if (/\b(?:pcom|polycystic\s+ovarian\s+morphology|polycystic\s+appearing\s+ovaries|peripheral\s+follicles)\b/i.test(text)) {
    observations.push({
      metric: 'Ultrasound Morphology',
      value: 'Features consistent with polycystic ovarian morphology (PCOM) noted on imaging',
      type: 'ultrasound_feature',
      formatted: 'Imaging: Polycystic ovarian morphology (PCOM) noted'
    });
  }

  if (/\btrilaminar\b/i.test(text)) {
    observations.push({
      metric: 'Endometrial Pattern',
      value: 'Trilaminar pattern noted',
      type: 'ultrasound_feature',
      formatted: 'Endometrium: Trilaminar pattern'
    });
  }

  return observations;
}

/**
 * Main assisted extraction function: takes report raw text and returns structured candidate results.
 * 
 * @param {string} text - Raw text from report, OCR, or user paste
 * @param {string} [refDate] - Fallback reference date if none detected in report
 * @returns {object} Structured extraction result with candidate items for user review
 */
export function extractReportDetails(text, refDate = null) {
  if (!text || typeof text !== 'string' || !text.trim()) {
    return {
      success: false,
      date: refDate || null,
      category: 'Blood / Hormone panel',
      findings: [],
      summaryString: '',
      observations: []
    };
  }

  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const detectedDateResult = extractReportDate(text);
  const date = detectedDateResult ? detectedDateResult.date : refDate;

  const findings = [];
  const foundMetricIds = new Set();

  // 1. Line-by-line and regex scan for clinical definitions
  for (const def of CLINICAL_EXTRACTION_DEFINITIONS) {
    if (foundMetricIds.has(def.id)) continue;

    // First scan line-by-line to maintain line-level reference range accuracy
    let matched = false;
    for (const line of lines) {
      if (def.keywords.some(kw => kw.test(line))) {
        const valueMatch = line.match(def.valueRegex);
        if (valueMatch) {
          const val = valueMatch[1];
          const unit = valueMatch[2] || def.defaultUnit;
          const range = extractReferenceInterval(line);

          findings.push({
            id: def.id,
            metric: def.name,
            value: val,
            unit,
            range: range || null,
            type: def.type,
            formatted: `${def.name}: ${val} ${unit}${range ? ` (ref ${range})` : ''}`,
            sourceSnippet: line.slice(0, 100)
          });

          foundMetricIds.add(def.id);
          matched = true;
          break;
        }
      }
    }

    // If not found line-by-line, test whole text regex
    if (!matched) {
      const fullMatch = text.match(def.valueRegex);
      if (fullMatch) {
        const val = fullMatch[1];
        const unit = fullMatch[2] || def.defaultUnit;
        findings.push({
          id: def.id,
          metric: def.name,
          value: val,
          unit,
          range: null,
          type: def.type,
          formatted: `${def.name}: ${val} ${unit}`,
          sourceSnippet: fullMatch[0]
        });
        foundMetricIds.add(def.id);
      }
    }
  }

  // 2. Compute LH:FSH ratio if both exist
  const lhFinding = findings.find(f => f.id === 'lh');
  const fshFinding = findings.find(f => f.id === 'fsh');
  if (lhFinding && fshFinding) {
    const lhVal = parseFloat(lhFinding.value);
    const fshVal = parseFloat(fshFinding.value);
    if (!isNaN(lhVal) && !isNaN(fshVal) && fshVal > 0) {
      const ratio = (lhVal / fshVal).toFixed(2);
      findings.push({
        id: 'lh_fsh_ratio',
        metric: 'LH:FSH Ratio',
        value: ratio,
        unit: 'ratio',
        range: null,
        type: 'hormone',
        formatted: `LH:FSH Ratio: ${ratio} (LH ${lhVal} / FSH ${fshVal})`,
        sourceSnippet: `Calculated from LH ${lhVal} and FSH ${fshVal}`
      });
    }
  }

  // 3. Extract qualitative ultrasound observations
  const observations = extractUltrasoundObservations(text);
  observations.forEach(obs => {
    findings.push({
      id: obs.metric.toLowerCase().replace(/[^a-z0-9]/g, '_'),
      metric: obs.metric,
      value: obs.value,
      unit: '',
      range: null,
      type: obs.type,
      formatted: obs.formatted,
      sourceSnippet: obs.value
    });
  });

  const category = detectReportCategory(text, findings);

  // 4. Build concise summary string for keyFinding field
  const summaryString = findings.map(f => f.formatted).join(' · ');

  return {
    success: findings.length > 0,
    date,
    dateConfidence: detectedDateResult?.confidence || 'none',
    dateSnippet: detectedDateResult?.raw || null,
    category,
    findings,
    summaryString,
    rawTextLength: text.length
  };
}
