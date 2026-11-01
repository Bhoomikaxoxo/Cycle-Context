/**
 * Client-Side Multi-Format Cycle & Health Data Importer
 *
 * 100% private, local-in-browser parser for importing cycle history from:
 * - Apple Health (export.xml or Apple Health CSV)
 * - Clue (CSV export)
 * - Flo (CSV export)
 * - Generic Period / Symptom CSV
 *
 * Converts foreign schemas into Cycle Context entries without external network calls.
 */

const CURRENT_SCHEMA_VERSION = 1;

/**
 * Normalizes ISO date string YYYY-MM-DD from various date representations
 */
export function normalizeDate(str) {
  if (!str) return null;
  const s = String(str).trim();

  // Match YYYY-MM-DD or YYYY/MM/DD
  const isoMatch = s.match(/^(\d{4})[-/](0?[1-9]|1[0-2])[-/](0?[1-9]|[12]\d|3[01])/);
  if (isoMatch) {
    const y = isoMatch[1];
    const m = String(isoMatch[2]).padStart(2, "0");
    const d = String(isoMatch[3]).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  // Match DD-MM-YYYY (hyphen format usually EU: 04-05-2026 -> 2026-05-04)
  const euHyphenMatch = s.match(/^(0?[1-9]|[12]\d|3[01])-(0?[1-9]|1[0-2])-(\d{4})/);
  if (euHyphenMatch) {
    const d = String(euHyphenMatch[1]).padStart(2, "0");
    const m = String(euHyphenMatch[2]).padStart(2, "0");
    const y = euHyphenMatch[3];
    return `${y}-${m}-${d}`;
  }

  // Match MM/DD/YYYY (slash format usually US: 05/04/2026 -> 2026-05-04)
  const usSlashMatch = s.match(/^(0?[1-9]|1[0-2])\/(0?[1-9]|[12]\d|3[01])\/(\d{4})/);
  if (usSlashMatch) {
    const m = String(usSlashMatch[1]).padStart(2, "0");
    const d = String(usSlashMatch[2]).padStart(2, "0");
    const y = usSlashMatch[3];
    return `${y}-${m}-${d}`;
  }

  // Match DD/MM/YYYY if day > 12
  const euSlashMatch = s.match(/^([12]\d|3[01])\/(0?[1-9]|1[0-2])\/(\d{4})/);
  if (euSlashMatch) {
    const d = String(euSlashMatch[1]).padStart(2, "0");
    const m = String(euSlashMatch[2]).padStart(2, "0");
    const y = euSlashMatch[3];
    return `${y}-${m}-${d}`;
  }

  // Fallback to JS Date parse
  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  return null;
}

/**
 * Split CSV line handling quotes
 */
function parseCSVLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"' || char === "'") {
      if (inQuotes && line[i + 1] === char) {
        current += char;
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

/**
 * Parse CSV text into array of object rows
 */
export function parseCSV(text) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];

  const headers = parseCSVLine(lines[0]).map((h) => h.toLowerCase().replace(/[\s_-]+/g, ""));
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const vals = parseCSVLine(lines[i]);
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = vals[idx] !== undefined ? vals[idx] : "";
    });
    rows.push(row);
  }
  return rows;
}

/**
 * Given a sorted array of unique bleeding date strings (YYYY-MM-DD),
 * group them into distinct bleeding episodes (gaps > 2 days start a new episode)
 * and generate Period Started and Period Ended entries.
 */
export function bleedingDatesToPeriodEntries(dates, sourceTag = "Imported") {
  if (!dates || !dates.length) return [];
  const sorted = [...new Set(dates)].sort();
  const episodes = [];
  let currentEpisode = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const prevTime = new Date(sorted[i - 1]).getTime();
    const currTime = new Date(sorted[i]).getTime();
    const diffDays = Math.round((currTime - prevTime) / 86400000);

    if (diffDays <= 2) {
      // Continuation of current bleeding episode
      currentEpisode.push(sorted[i]);
    } else {
      episodes.push(currentEpisode);
      currentEpisode = [sorted[i]];
    }
  }
  if (currentEpisode.length) {
    episodes.push(currentEpisode);
  }

  const generated = [];
  for (const ep of episodes) {
    const startDate = ep[0];
    const endDate = ep[ep.length - 1];

    generated.push({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      id: "import_start_" + startDate + "_" + Math.random().toString(36).slice(2, 7),
      date: startDate,
      type: "period",
      title: "Period started",
      periodRole: "start",
      flow: "medium",
      detail: `${sourceTag} period start (${ep.length} day episode)`,
      imported: true,
      source: sourceTag,
    });

    if (endDate !== startDate) {
      generated.push({
        schemaVersion: CURRENT_SCHEMA_VERSION,
        id: "import_end_" + endDate + "_" + Math.random().toString(36).slice(2, 7),
        date: endDate,
        type: "period",
        title: "Period ended",
        periodRole: "end",
        flow: "light",
        detail: `${sourceTag} period end`,
        imported: true,
        source: sourceTag,
      });
    }
  }

  return generated;
}

/**
 * Detect file type from content string and filename
 */
export function detectFormat(content, filename = "") {
  const lowerName = filename.toLowerCase();
  const lowerContent = content.slice(0, 2000).toLowerCase();

  if (lowerContent.includes("<?xml") || lowerContent.includes("<healthdata") || lowerContent.includes("hkcategorytypeidentifier")) {
    return "apple_health_xml";
  }
  if (lowerName.endsWith(".xml")) {
    return "apple_health_xml";
  }

  if (lowerContent.includes("hkcategorytypeidentifier") || lowerContent.includes("hkcategoryvaluemenstrualflow")) {
    return "apple_health_csv";
  }

  if (lowerContent.includes("clue") || (lowerContent.includes("category") && lowerContent.includes("bleeding"))) {
    return "clue_csv";
  }

  if (lowerContent.includes("flow") && (lowerContent.includes("symptoms") || lowerContent.includes("cycle day"))) {
    return "flo_csv";
  }

  if (lowerContent.includes("period") || lowerContent.includes("bleeding") || lowerContent.includes("cramp")) {
    return "generic_csv";
  }

  return "unknown";
}

/**
 * Parse Apple Health XML (export.xml)
 */
export function parseAppleHealthXML(xmlText) {
  const bleedingDates = [];
  const symptoms = [];

  // Match HKCategoryTypeIdentifierMenstrualFlow records
  const recordRegex = /<Record\s+[^>]*type="(HKCategoryTypeIdentifierMenstrualFlow|HKCategoryTypeIdentifierIntermenstrualBleeding|HKCategoryTypeIdentifierCervicalMucusQuality|HKCategoryTypeIdentifierOvulationTestResult)"[^>]*>/gi;
  const dateRegex = /startDate="([^"]+)"/i;
  const valueRegex = /value="([^"]+)"/i;

  let match;
  while ((match = recordRegex.exec(xmlText)) !== null) {
    const fullTag = match[0];
    const recType = match[1];
    const dateMatch = dateRegex.exec(fullTag);
    const valMatch = valueRegex.exec(fullTag);

    if (dateMatch) {
      const iso = normalizeDate(dateMatch[1]);
      if (iso) {
        if (recType === "HKCategoryTypeIdentifierMenstrualFlow") {
          const val = valMatch ? valMatch[1] : "";
          // Check if it represents actual bleeding (not none)
          if (!val.toLowerCase().includes("none")) {
            bleedingDates.push(iso);
          }
        } else if (recType === "HKCategoryTypeIdentifierIntermenstrualBleeding") {
          symptoms.push({
            schemaVersion: CURRENT_SCHEMA_VERSION,
            id: "import_sym_" + iso + "_" + Math.random().toString(36).slice(2, 7),
            date: iso,
            type: "symptom",
            title: "Mid-cycle Spotting",
            symptomSlug: "spotting",
            detail: "Apple Health intermenstrual bleeding record",
            imported: true,
            source: "Apple Health",
          });
        }
      }
    }
  }

  const periodEntries = bleedingDatesToPeriodEntries(bleedingDates, "Apple Health");
  return {
    source: "Apple Health (XML)",
    entries: [...periodEntries, ...symptoms],
    stats: {
      periodStarts: periodEntries.filter((e) => e.periodRole === "start").length,
      periodEnds: periodEntries.filter((e) => e.periodRole === "end").length,
      symptoms: symptoms.length,
      totalBleedingDays: new Set(bleedingDates).size,
    },
  };
}

/**
 * Parse Apple Health CSV export
 */
export function parseAppleHealthCSV(csvText) {
  const rows = parseCSV(csvText);
  const bleedingDates = [];
  const symptoms = [];

  for (const r of rows) {
    const type = r.type || r.recordtype || "";
    const startDate = r.startdate || r.date || "";
    const val = r.value || "";

    const iso = normalizeDate(startDate);
    if (!iso) continue;

    if (type.includes("MenstrualFlow")) {
      if (!val.toLowerCase().includes("none")) {
        bleedingDates.push(iso);
      }
    } else if (type.includes("IntermenstrualBleeding") || val.includes("Spotting")) {
      symptoms.push({
        schemaVersion: CURRENT_SCHEMA_VERSION,
        id: "import_sym_" + iso + "_" + Math.random().toString(36).slice(2, 7),
        date: iso,
        type: "symptom",
        title: "Spotting",
        symptomSlug: "spotting",
        detail: "Apple Health spotting entry",
        imported: true,
        source: "Apple Health",
      });
    }
  }

  const periodEntries = bleedingDatesToPeriodEntries(bleedingDates, "Apple Health");
  return {
    source: "Apple Health (CSV)",
    entries: [...periodEntries, ...symptoms],
    stats: {
      periodStarts: periodEntries.filter((e) => e.periodRole === "start").length,
      periodEnds: periodEntries.filter((e) => e.periodRole === "end").length,
      symptoms: symptoms.length,
      totalBleedingDays: new Set(bleedingDates).size,
    },
  };
}

/**
 * Parse Clue CSV export
 */
export function parseClueCSV(csvText) {
  const rows = parseCSV(csvText);
  const bleedingDates = [];
  const symptoms = [];

  for (const r of rows) {
    const dateStr = r.date || r.day || "";
    const iso = normalizeDate(dateStr);
    if (!iso) continue;

    const cat = (r.category || "").toLowerCase();
    const type = (r.type || r.value || "").toLowerCase();
    const notes = r.notes || r.note || "";

    if (cat.includes("period") || cat.includes("bleeding") || type.includes("period") || type.includes("bleeding") || type.includes("heavy") || type.includes("medium") || type.includes("light")) {
      bleedingDates.push(iso);
    } else if (cat.includes("pain") || cat.includes("cramp") || type.includes("cramp") || type.includes("pain")) {
      symptoms.push({
        schemaVersion: CURRENT_SCHEMA_VERSION,
        id: "import_clue_" + iso + "_" + Math.random().toString(36).slice(2, 7),
        date: iso,
        type: "symptom",
        title: type.includes("cramp") ? "Pelvic Cramping" : "Pelvic Pain",
        symptomSlug: "pelvic_pain",
        detail: notes || `Clue logged: ${r.type || r.category}`,
        imported: true,
        source: "Clue",
      });
    } else if (cat.includes("mood") || type.includes("mood") || type.includes("pms") || type.includes("tender")) {
      symptoms.push({
        schemaVersion: CURRENT_SCHEMA_VERSION,
        id: "import_clue_" + iso + "_" + Math.random().toString(36).slice(2, 7),
        date: iso,
        type: "symptom",
        title: r.type || "Pre-menstrual symptom",
        detail: notes || `Clue logged: ${r.category}`,
        imported: true,
        source: "Clue",
      });
    }
  }

  const periodEntries = bleedingDatesToPeriodEntries(bleedingDates, "Clue");
  return {
    source: "Clue (CSV)",
    entries: [...periodEntries, ...symptoms],
    stats: {
      periodStarts: periodEntries.filter((e) => e.periodRole === "start").length,
      periodEnds: periodEntries.filter((e) => e.periodRole === "end").length,
      symptoms: symptoms.length,
      totalBleedingDays: new Set(bleedingDates).size,
    },
  };
}

/**
 * Parse Flo CSV export
 */
export function parseFloCSV(csvText) {
  const rows = parseCSV(csvText);
  const bleedingDates = [];
  const symptoms = [];

  for (const r of rows) {
    const dateStr = r.date || "";
    const iso = normalizeDate(dateStr);
    if (!iso) continue;

    const flow = (r.flow || "").toLowerCase();
    const symptomStr = r.symptoms || "";
    const notes = r.notes || "";

    if (flow && !flow.includes("none") && flow !== "0") {
      bleedingDates.push(iso);
    }

    if (symptomStr) {
      symptoms.push({
        schemaVersion: CURRENT_SCHEMA_VERSION,
        id: "import_flo_" + iso + "_" + Math.random().toString(36).slice(2, 7),
        date: iso,
        type: "symptom",
        title: symptomStr.split(/[,;]/)[0].trim() || "Symptom",
        detail: notes ? `${symptomStr} · ${notes}` : symptomStr,
        imported: true,
        source: "Flo",
      });
    }
  }

  const periodEntries = bleedingDatesToPeriodEntries(bleedingDates, "Flo");
  return {
    source: "Flo (CSV)",
    entries: [...periodEntries, ...symptoms],
    stats: {
      periodStarts: periodEntries.filter((e) => e.periodRole === "start").length,
      periodEnds: periodEntries.filter((e) => e.periodRole === "end").length,
      symptoms: symptoms.length,
      totalBleedingDays: new Set(bleedingDates).size,
    },
  };
}

/**
 * Parse Generic Period/Symptom CSV
 */
export function parseGenericCSV(csvText) {
  const rows = parseCSV(csvText);
  const entries = [];
  const bleedingDates = [];

  for (const r of rows) {
    const dateStr = r.date || r.day || r.entrydate || "";
    const iso = normalizeDate(dateStr);
    if (!iso) continue;

    const event = (r.event || r.type || r.title || "").toLowerCase();
    const notes = r.notes || r.note || r.details || r.detail || "";

    if (event.includes("start") || event === "period started" || event === "started") {
      entries.push({
        schemaVersion: CURRENT_SCHEMA_VERSION,
        id: "import_gen_" + iso + "_" + Math.random().toString(36).slice(2, 7),
        date: iso,
        type: "period",
        title: "Period started",
        periodRole: "start",
        flow: "medium",
        detail: notes || "Imported period start",
        imported: true,
        source: "CSV",
      });
    } else if (event.includes("end") || event === "period ended" || event === "ended") {
      entries.push({
        schemaVersion: CURRENT_SCHEMA_VERSION,
        id: "import_gen_" + iso + "_" + Math.random().toString(36).slice(2, 7),
        date: iso,
        type: "period",
        title: "Period ended",
        periodRole: "end",
        flow: "light",
        detail: notes || "Imported period end",
        imported: true,
        source: "CSV",
      });
    } else if (event.includes("period") || event.includes("bleeding") || event.includes("flow")) {
      bleedingDates.push(iso);
    } else {
      entries.push({
        schemaVersion: CURRENT_SCHEMA_VERSION,
        id: "import_gen_" + iso + "_" + Math.random().toString(36).slice(2, 7),
        date: iso,
        type: "symptom",
        title: r.event || r.type || r.title || "Logged symptom",
        detail: notes,
        imported: true,
        source: "CSV",
      });
    }
  }

  // If there were generic bleeding rows without explicit start/end markers
  if (bleedingDates.length) {
    const derived = bleedingDatesToPeriodEntries(bleedingDates, "CSV");
    entries.push(...derived);
  }

  return {
    source: "Generic CSV",
    entries,
    stats: {
      periodStarts: entries.filter((e) => e.periodRole === "start").length,
      periodEnds: entries.filter((e) => e.periodRole === "end").length,
      symptoms: entries.filter((e) => e.type === "symptom").length,
      totalBleedingDays: bleedingDates.length,
    },
  };
}

/**
 * Main auto-detect and parse function
 */
export function importHistoricalData(content, filename = "") {
  const format = detectFormat(content, filename);

  switch (format) {
    case "apple_health_xml":
      return parseAppleHealthXML(content);
    case "apple_health_csv":
      return parseAppleHealthCSV(content);
    case "clue_csv":
      return parseClueCSV(content);
    case "flo_csv":
      return parseFloCSV(content);
    case "generic_csv":
      return parseGenericCSV(content);
    default:
      // Try generic CSV parser as fallback
      const fallback = parseGenericCSV(content);
      if (fallback.entries.length) return fallback;
      throw new Error("Unrecognized file format. Supported formats: Apple Health (XML/CSV), Clue CSV, Flo CSV, or standard period/symptom CSV.");
  }
}

/**
 * Merge newly imported entries into existing entries without duplicate starts/ends on the same date
 */
export function mergeImportedEntries(existingEntries, importedEntries) {
  const map = new Map();

  for (const e of existingEntries) {
    const key = `${e.date}__${e.type}__${e.periodRole || e.title || ""}`;
    map.set(key, e);
  }

  let addedCount = 0;
  for (const imp of importedEntries) {
    const key = `${imp.date}__${imp.type}__${imp.periodRole || imp.title || ""}`;
    if (!map.has(key)) {
      map.set(key, imp);
      addedCount++;
    }
  }

  const merged = Array.from(map.values()).sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return (a.title || "").localeCompare(b.title || "");
  });

  return { merged, addedCount };
}
