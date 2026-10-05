// Usage: node evaluate-extraction.js [--split dev|test|test-v1] [--adapter ./adapter.js] [--oracle] [--speech-mode] [--min-f1 0.8]
import fs from "node:fs";
import { toSpeech } from "./speech-variant.js";

const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const split = opt("--split", "dev");
const minF1 = parseFloat(opt("--min-f1", "0"));
const oracle = args.includes("--oracle");
const speech = args.includes("--speech-mode"); // feed lowercase, unpunctuated text
const { extract } = oracle ? { extract: null } : await import(opt("--adapter", "./adapter.js"));

const data = JSON.parse(fs.readFileSync(new URL("./dataset.json", import.meta.url)));
const toDay = (s) => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); };
const lab = (e) => (e.label || "").toLowerCase();
const key = (e) => [e.kind, lab(e), e.date].join("|");
const grp = (e) => [e.kind, lab(e)].join("|");

const kinds = {};
const t = (k) => (kinds[k] ??= { tp: 0, fp: 0, fn: 0 });
const dateErr = { "off-by-1": 0, "off-by-7": 0, other: 0, "no-date": 0 };
const failures = [];
let negCases = 0, negFail = 0, evaluated = 0;

for (const c of data.cases.filter((c) => c.split === split)) {
  evaluated++;
  const pred = oracle ? c.expected.map((e) => ({ ...e })) : (await extract(speech ? toSpeech(c.text) : c.text, c.refDate)) || [];
  const missing = [...c.expected], extra = [];
  for (const p of pred) {
    const i = missing.findIndex((e) => key(e) === key(p));
    if (i >= 0) { missing.splice(i, 1); t(p.kind).tp++; } else extra.push(p);
  }
  // classify date errors: same kind+label, wrong/missing date
  for (const e of [...missing]) {
    const j = extra.findIndex((p) => grp(p) === grp(e));
    if (j < 0) continue;
    const p = extra[j];
    if (!p.date) dateErr["no-date"]++;
    else {
      const d = Math.abs(Math.round((toDay(p.date) - toDay(e.date)) / 86400000));
      dateErr[d === 1 ? "off-by-1" : d === 7 ? "off-by-7" : "other"]++;
    }
  }
  missing.forEach((e) => t(e.kind).fn++);
  extra.forEach((p) => t(p.kind).fp++);
  if (c.tags.includes("negation")) { negCases++; if (extra.length) negFail++; }
  if (missing.length || extra.length) failures.push({ id: c.id, text: c.text, missing, extra });
}

const f = (n, d) => (d ? n / d : 0);
console.log(`\nSplit: ${split} | cases: ${evaluated}${speech ? " | SPEECH MODE (unpunctuated)" : ""}${oracle ? " | ORACLE (harness self-check)" : ""}\n`);
console.log("kind          P      R      F1");
let allTp = 0, allFp = 0, allFn = 0;
for (const [k, v] of Object.entries(kinds)) {
  const p = f(v.tp, v.tp + v.fp), r = f(v.tp, v.tp + v.fn), f1 = f(2 * p * r, p + r);
  allTp += v.tp; allFp += v.fp; allFn += v.fn;
  console.log(`${k.padEnd(13)} ${p.toFixed(2)}   ${r.toFixed(2)}   ${f1.toFixed(2)}`);
}
const P = f(allTp, allTp + allFp), R = f(allTp, allTp + allFn), F1 = f(2 * P * R, P + R);
console.log(`${"OVERALL".padEnd(13)} ${P.toFixed(2)}   ${R.toFixed(2)}   ${F1.toFixed(2)}`);
console.log("\nDate errors:", dateErr);
console.log(`Negation cases with false positives: ${negFail}/${negCases}`);
if (failures.length) {
  console.log("\nFailures:");
  failures.forEach((x) => console.log(` ${x.id} "${x.text}"\n   missing: ${JSON.stringify(x.missing)}\n   extra:   ${JSON.stringify(x.extra)}`));
}
if (F1 < minF1) { console.error(`\nF1 ${F1.toFixed(2)} below threshold ${minF1}`); process.exit(1); }
