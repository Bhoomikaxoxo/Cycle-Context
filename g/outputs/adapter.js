import { parseVoiceEvents } from "./extraction.js";

// WIRE THIS TO YOUR APP. Must return an array of
//   { kind: "period-start"|"period-end"|"symptom"|"context", label?: string, date: "YYYY-MM-DD" | null }
export async function extract(text, refDate) {
  const events = parseVoiceEvents(text, refDate);
  return events
    .filter((e) => e.kind !== "note")
    .map((e) => {
      const res = { kind: e.kind, date: e.date };
      if (e.kind === "symptom" || e.kind === "context") {
        res.label = (e.title || "").toLowerCase();
      }
      return res;
    });
}
