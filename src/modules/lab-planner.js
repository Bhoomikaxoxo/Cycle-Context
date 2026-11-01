/**
 * Clinical Lab Work Timing Planner & "Day 21" Myth Buster Engine
 *
 * Implements ACOG and Endocrine Society physiological timing guidelines:
 * - Basal Day 2-4: FSH, LH, E2, AMH, TSH
 * - Post-menstrual Day 5-10: Baseline pelvic ultrasound / Antral Follicle Count
 * - Personalized Mid-Luteal Progesterone: Calculated as (Cycle Length - 7 days),
 *   dispelling the misleading rigid "Day 21" schedule for variable/longer cycles.
 * - Exports formatted iCalendar (.ics) files for 1-click calendar sync.
 */

const DAY_MS = 86400000;

export function addDaysToDate(isoDate, days) {
  const parts = isoDate.split("-").map(Number);
  const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function formatClinicalDateString(isoDate) {
  if (!isoDate) return "—";
  const parts = isoDate.split("-").map(Number);
  const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  return d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Computes personalized clinical lab schedule
 * @param {string} lastPeriodStart - YYYY-MM-DD
 * @param {number} cycleLength - Personal cycle length in days (e.g. 28, 35, 42)
 */
export function calculateLabSchedule(lastPeriodStart, cycleLength = 28) {
  if (!lastPeriodStart) return null;
  const len = Math.max(21, Math.min(90, Math.round(Number(cycleLength) || 28)));

  // Day 1 is lastPeriodStart
  // Basal: Cycle Day 2 to Day 4 (i.e. +1 to +3 days from start)
  const basalStart = addDaysToDate(lastPeriodStart, 1);
  const basalEnd = addDaysToDate(lastPeriodStart, 3);

  // Ultrasound: Cycle Day 5 to Day 10 (i.e. +4 to +9 days)
  const ultrasoundStart = addDaysToDate(lastPeriodStart, 4);
  const ultrasoundEnd = addDaysToDate(lastPeriodStart, 9);

  // Mid-luteal progesterone: (cycleLength - 7 days) target, +/- 1 day window
  const lutealTargetDay = Math.max(14, len - 7);
  const lutealStartDay = lutealTargetDay - 1;
  const lutealEndDay = lutealTargetDay + 1;

  const lutealDate = addDaysToDate(lastPeriodStart, lutealTargetDay - 1);
  const lutealStartDate = addDaysToDate(lastPeriodStart, lutealStartDay - 1);
  const lutealEndDate = addDaysToDate(lastPeriodStart, lutealEndDay - 1);

  // Estimated next period start
  const nextPeriodDate = addDaysToDate(lastPeriodStart, len);

  // Myth buster note
  const isDifferentFromDay21 = lutealTargetDay !== 21;
  const dayDifference = lutealTargetDay - 21;
  const mythExplanation = isDifferentFromDay21
    ? `For your ${len}-day cycle, testing on the conventional "Day 21" would draw blood ${Math.abs(dayDifference)} days ${dayDifference > 0 ? "too early (often before ovulation has even occurred!)" : "too late"}. Your true mid-luteal progesterone peak occurs on Cycle Day ${lutealTargetDay}.`
    : `In a standard 28-day cycle, the conventional "Day 21" matches your mid-luteal peak (7 days before next period).`;

  return {
    lastPeriodStart,
    cycleLength: len,
    nextPeriodDate,
    phases: {
      basal: {
        id: "basal_hormones",
        name: "Basal Hormone Panel",
        cycleDays: "Cycle Days 2–4",
        startDate: basalStart,
        endDate: basalEnd,
        tests: ["FSH (Follicle-Stimulating Hormone)", "LH (Luteinizing Hormone)", "Estradiol (E2)", "AMH", "TSH", "Prolactin"],
        purpose: "Evaluates ovarian reserve and pituitary baseline before dominant follicle selection elevates estradiol.",
      },
      ultrasound: {
        id: "pelvic_ultrasound",
        name: "Baseline Pelvic Ultrasound",
        cycleDays: "Cycle Days 5–10",
        startDate: ultrasoundStart,
        endDate: ultrasoundEnd,
        tests: ["Endometrial thickness measurement", "Antral Follicle Count (AFC)", "Ovarian morphology"],
        purpose: "Measures thin post-menstrual baseline lining (<4mm) and follicle count before follicle dominance.",
      },
      progesterone: {
        id: "mid_luteal_progesterone",
        name: "True Mid-Luteal Progesterone",
        cycleDays: `Cycle Day ${lutealTargetDay} (Window: Days ${lutealStartDay}–${lutealEndDay})`,
        targetDay: lutealTargetDay,
        startDate: lutealStartDate,
        endDate: lutealEndDate,
        exactTargetDate: lutealDate,
        tests: ["Serum Progesterone (P4)"],
        purpose: "Confirms ovulation and assesses corpus luteum secretory sufficiency at peak luteal concentration.",
        mythBuster: {
          isStandard28: !isDifferentFromDay21,
          targetDay: lutealTargetDay,
          dayDifference,
          explanation: mythExplanation,
        },
      },
    },
  };
}

/**
 * Generates an RFC 5545 standard .ics iCalendar file string for 1-click calendar sync
 */
export function generateLabICS(schedule) {
  if (!schedule) return "";
  const now = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";

  function formatICSDate(iso) {
    return iso.replace(/-/g, "");
  }

  const events = [
    {
      summary: `Lab Work: Basal Hormone Panel (${schedule.phases.basal.cycleDays})`,
      description: `${schedule.phases.basal.purpose}\\nTests: ${schedule.phases.basal.tests.join(", ")}`,
      dtstart: formatICSDate(schedule.phases.basal.startDate),
      dtend: formatICSDate(addDaysToDate(schedule.phases.basal.endDate, 1)),
    },
    {
      summary: `Imaging: Baseline Pelvic Ultrasound (${schedule.phases.ultrasound.cycleDays})`,
      description: `${schedule.phases.ultrasound.purpose}\\nScans: ${schedule.phases.ultrasound.tests.join(", ")}`,
      dtstart: formatICSDate(schedule.phases.ultrasound.startDate),
      dtend: formatICSDate(addDaysToDate(schedule.phases.ultrasound.endDate, 1)),
    },
    {
      summary: `Lab Work: Mid-Luteal Progesterone (${schedule.phases.progesterone.cycleDays})`,
      description: `${schedule.phases.progesterone.purpose}\\n${schedule.phases.progesterone.mythBuster.explanation}\\nTests: Serum Progesterone`,
      dtstart: formatICSDate(schedule.phases.progesterone.startDate),
      dtend: formatICSDate(addDaysToDate(schedule.phases.progesterone.endDate, 1)),
    },
  ];

  let ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Cycle Context//Clinical Lab Planner//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];

  events.forEach((ev, i) => {
    ics.push(
      "BEGIN:VEVENT",
      `UID:cycle-context-lab-${schedule.lastPeriodStart}-${i}@cyclecontext.local`,
      `DTSTAMP:${now}`,
      `DTSTART;VALUE=DATE:${ev.dtstart}`,
      `DTEND;VALUE=DATE:${ev.dtend}`,
      `SUMMARY:${ev.summary}`,
      `DESCRIPTION:${ev.description}`,
      "STATUS:CONFIRMED",
      "TRANSP:TRANSPARENT",
      "END:VEVENT"
    );
  });

  ics.push("END:VCALENDAR");
  return ics.join("\r\n");
}
