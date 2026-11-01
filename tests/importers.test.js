import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeDate,
  parseCSV,
  bleedingDatesToPeriodEntries,
  detectFormat,
  parseAppleHealthXML,
  parseAppleHealthCSV,
  parseClueCSV,
  parseFloCSV,
  parseGenericCSV,
  importHistoricalData,
  mergeImportedEntries,
} from "../src/modules/importers.js";

test("normalizeDate formats various date patterns into YYYY-MM-DD", () => {
  assert.equal(normalizeDate("2026-05-04"), "2026-05-04");
  assert.equal(normalizeDate("2026/05/04 09:30:00"), "2026-05-04");
  assert.equal(normalizeDate("04-05-2026"), "2026-05-04");
  assert.equal(normalizeDate("05/04/2026"), "2026-05-04");
});

test("bleedingDatesToPeriodEntries groups consecutive bleeding days into start and end", () => {
  const dates = ["2026-05-04", "2026-05-05", "2026-05-06", "2026-05-07", "2026-06-15", "2026-06-16"];
  const entries = bleedingDatesToPeriodEntries(dates, "TestApp");

  assert.equal(entries.length, 4); // 2 starts, 2 ends
  assert.equal(entries[0].date, "2026-05-04");
  assert.equal(entries[0].periodRole, "start");
  assert.equal(entries[1].date, "2026-05-07");
  assert.equal(entries[1].periodRole, "end");
  assert.equal(entries[2].date, "2026-06-15");
  assert.equal(entries[2].periodRole, "start");
  assert.equal(entries[3].date, "2026-06-16");
  assert.equal(entries[3].periodRole, "end");
});

test("parseAppleHealthXML extracts bleeding and spotting correctly", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
  <HealthData locale="en_US">
    <Record type="HKCategoryTypeIdentifierMenstrualFlow" sourceName="Health" startDate="2026-05-04 08:00:00" endDate="2026-05-04 20:00:00" value="HKCategoryValueMenstrualFlowHeavy"/>
    <Record type="HKCategoryTypeIdentifierMenstrualFlow" sourceName="Health" startDate="2026-05-05 08:00:00" endDate="2026-05-05 20:00:00" value="HKCategoryValueMenstrualFlowMedium"/>
    <Record type="HKCategoryTypeIdentifierMenstrualFlow" sourceName="Health" startDate="2026-05-06 08:00:00" endDate="2026-05-06 20:00:00" value="HKCategoryValueMenstrualFlowLight"/>
    <Record type="HKCategoryTypeIdentifierIntermenstrualBleeding" sourceName="Health" startDate="2026-05-18 10:00:00" endDate="2026-05-18 10:05:00" value="HKCategoryValueNotApplicable"/>
  </HealthData>`;

  const result = parseAppleHealthXML(xml);
  assert.equal(result.source, "Apple Health (XML)");
  assert.equal(result.stats.periodStarts, 1);
  assert.equal(result.stats.periodEnds, 1);
  assert.equal(result.stats.symptoms, 1); // 1 spotting
});

test("parseClueCSV handles period and symptom rows", () => {
  const csv = `date,category,type,notes
2026-05-04,period,heavy,first day
2026-05-05,period,medium,
2026-05-06,period,light,
2026-05-18,pain,cramps,mid-cycle ovulation ache`;

  const result = parseClueCSV(csv);
  assert.equal(result.source, "Clue (CSV)");
  assert.equal(result.stats.periodStarts, 1);
  assert.equal(result.stats.periodEnds, 1);
  assert.equal(result.stats.symptoms, 1);
});

test("parseFloCSV parses Flo flow and symptoms", () => {
  const csv = `Date,Cycle Day,Flow,Symptoms,Notes
2026-05-04,1,Heavy,Cramps,Day 1
2026-05-05,2,Medium,,
2026-05-06,3,Light,,`;

  const result = parseFloCSV(csv);
  assert.equal(result.stats.periodStarts, 1);
  assert.equal(result.stats.periodEnds, 1);
  assert.equal(result.stats.symptoms, 1);
});

test("mergeImportedEntries eliminates exact duplicates", () => {
  const existing = [
    { date: "2026-05-04", type: "period", periodRole: "start", title: "Period started" },
  ];
  const imported = [
    { date: "2026-05-04", type: "period", periodRole: "start", title: "Period started" },
    { date: "2026-05-08", type: "period", periodRole: "end", title: "Period ended" },
  ];

  const { merged, addedCount } = mergeImportedEntries(existing, imported);
  assert.equal(addedCount, 1);
  assert.equal(merged.length, 2);
});
