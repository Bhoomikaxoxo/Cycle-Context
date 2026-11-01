import test from "node:test";
import assert from "node:assert/strict";
import {
  addDaysToDate,
  calculateLabSchedule,
  generateLabICS,
} from "../src/modules/lab-planner.js";

test("addDaysToDate handles month boundaries and leap years", () => {
  assert.equal(addDaysToDate("2026-05-28", 5), "2026-06-02");
  assert.equal(addDaysToDate("2026-02-28", 1), "2026-03-01");
});

test("calculateLabSchedule correctly computes Day 21 myth buster for a 35-day cycle", () => {
  // Period start: 2026-05-01, Cycle length: 35 days
  const schedule = calculateLabSchedule("2026-05-01", 35);
  assert.ok(schedule);

  // Basal hormone: Days 2 to 4 -> May 2 to May 4
  assert.equal(schedule.phases.basal.startDate, "2026-05-02");
  assert.equal(schedule.phases.basal.endDate, "2026-05-04");

  // Mid-luteal progesterone target day: 35 - 7 = 28! (Not Day 21)
  assert.equal(schedule.phases.progesterone.targetDay, 28);
  assert.equal(schedule.phases.progesterone.mythBuster.dayDifference, 7);
  assert.match(schedule.phases.progesterone.mythBuster.explanation, /too early/);

  // Day 28 from May 01 is May 28
  assert.equal(schedule.phases.progesterone.exactTargetDate, "2026-05-28");
});

test("calculateLabSchedule correctly matches Day 21 for a classic 28-day cycle", () => {
  const schedule = calculateLabSchedule("2026-05-01", 28);
  assert.equal(schedule.phases.progesterone.targetDay, 21);
  assert.equal(schedule.phases.progesterone.mythBuster.isStandard28, true);
  assert.equal(schedule.phases.progesterone.exactTargetDate, "2026-05-21");
});

test("generateLabICS creates valid iCalendar string with all 3 events", () => {
  const schedule = calculateLabSchedule("2026-05-01", 35);
  const ics = generateLabICS(schedule);

  assert.match(ics, /BEGIN:VCALENDAR/);
  assert.match(ics, /END:VCALENDAR/);
  assert.match(ics, /Basal Hormone Panel/);
  assert.match(ics, /Baseline Pelvic Ultrasound/);
  assert.match(ics, /Mid-Luteal Progesterone/);
});
