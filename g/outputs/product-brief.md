# Product brief: cycle context journal

**Working title:** Cycle Context  
**Status:** First product definition  
**Product type:** Responsive web app  
**Primary goal:** Help people with irregular or changing cycles make sense of their own history and communicate it clearly to a healthcare professional—without diagnosing or prescribing.

## The problem

Many cycle apps turn a small set of past dates into a confident-looking prediction. That can be a poor fit for people whose cycles vary, including people with PCOS/PCOD, people experiencing health or life changes, and people whose patterns are not yet established. A calendar prediction alone can hide the very changes a person is trying to understand.

People also keep relevant information in separate places: cycle logs, symptom notes, medication changes, clinician notes, and medical reports. It is hard to see what happened when, and hard to bring a concise, accurate history to an appointment.

## Product idea

Build a **change-aware cycle journal**. It helps a person establish a personal baseline, mark meaningful changes over time, and compare their own history before and after those changes. The app presents recorded facts, user-confirmed report details, and calculated observations as distinct things. It shows uncertainty plainly and lets the user decide what to share.

The defining experience is not “your next period will start on Tuesday.” It is: **“Here is how your own pattern has varied, what you recorded around those changes, and what you may want to discuss with your clinician.”**

## Who it is for

### Primary users

- People with irregular or changing menstrual cycles.
- People tracking symptoms alongside cycle dates.
- People preparing for a clinician appointment and wanting an organized history.

### Not intended for

- Diagnosing PCOS/PCOD, endometriosis, infertility, deficiencies, depression, or other conditions.
- Recommending medication, supplements, or treatment.
- Replacing a clinician, emergency care, or a clinician-provided care plan.
- Making fertility or contraception guarantees.

## Product objectives

1. **Make tracking low effort.** A daily check-in should take about a minute, with optional detail rather than a long required questionnaire.
2. **Represent variation honestly.** Show ranges and observed history. Avoid false precision when there is too little or too variable data.
3. **Make changes legible.** Let users annotate personal or clinical milestones and compare their own timeline across those points.
4. **Connect records with consent.** Let users add a report or clinician note, review extracted details, and choose whether confirmed details appear on the timeline.
5. **Help users communicate.** Create an editable, date-based appointment summary that separates entries, imported facts, and app-calculated observations.
6. **Keep the user in control.** Make edits, deletion, privacy controls, and sharing understandable and easy to find.

## What makes it distinct

### Personal baseline, not a one-size-fits-all prediction

The app learns from the user’s own recorded history. It can show typical ranges and changes in those ranges, while making clear when there is not enough information to estimate. A prediction is optional, visibly uncertain, and never the headline for users whose history does not support it.

### Change markers on the timeline

Users can mark events they believe are relevant, such as starting or changing a medication, a diagnosis recorded by a clinician, a major life change, or a change in routine. Sensitive markers are optional. The app can compare recorded patterns before and after a marker, but must not present the marker as a cause.

Example: “In the 4 cycles before this date, recorded cycle lengths ranged from 28–34 days. In the 3 cycles after, they ranged from 36–51 days.” Add a neutral note: “This comparison describes timing in your records; it does not establish why it changed.”

### Evidence labels and provenance

Every item and insight should make its source clear:

- **You logged** — information entered by the user.
- **From a report** — text extracted from an uploaded document and confirmed by the user.
- **Calculated from your logs** — a descriptive statistic or comparison.
- **Clinician note** — a user-entered or confirmed note attributed to a clinician document.

Never silently convert an extracted phrase into a diagnosis or confirmed medical fact.

## First release scope

### Include

- Private account and onboarding with a skip option for sensitive questions.
- Cycle and bleeding log: start/end dates, flow level, and corrections to past dates.
- A voice-first check-in that preserves the full transcript and suggests separate dated events for period starts, period ends, symptoms, and context. Users can edit dates, change categories, remove suggestions, or add details before saving.
- A quick manual check-in when voice input is unavailable or unwanted.
- Optional context markers, each with date, category, and user-written description.
- A personal timeline and cycle history view with ranges, recorded bleeding duration, and plain-language summaries that update from saved entries.
- A “how this is calculated” explanation for each chart or observation.
- A private local document library with separate metadata, report date, user note, and optional inclusion in the appointment summary for each file.
- A source link between voice-derived timeline events and their original transcript.
- An editable appointment summary export that the user explicitly generates and shares.
- Delete individual entries, documents, or the account; clear privacy settings.

### Defer until later

- Automated extraction or interpretation of medical reports.
- Prediction of ovulation, fertility windows, or pregnancy likelihood.
- Social/community feed, clinician portal, or family sharing.
- Recommendations about nutrition, supplements, diagnosis, or treatment.
- Integrations with wearables, pharmacy systems, or electronic health records.

## Main user journey

1. **Set up:** Explain the app’s purpose and limitations. Ask only for what is needed to begin; let the person skip optional health questions.
2. **Check in:** Speak naturally about dates and how you felt. Review the transcript and dated details the app recognized, then save the original wording and confirmed events together.
3. **Review:** See a timeline of logged events and a cycle history that uses ranges instead of implying clockwork regularity.
4. **Add records:** Upload reports from this device, give each its own date and note, and choose which notes to include in an appointment summary. The first version does not read report contents automatically.
5. **Explore a change:** Select a timeline marker and compare the recorded periods before and after it. Display counts, dates, and limitations next to the comparison.
6. **Prepare:** Select a date range and topics, review an editable summary, then export only after explicit confirmation.

## UI direction

### Experience principles

- **Calm, clear, and adult:** supportive without being cute, infantilizing, or overly clinical.
- **No shame and no pressure:** no streaks, missed-day warnings, red alarm states for ordinary variation, or guilt language.
- **Uncertainty is visible:** distinguish logged facts from estimates; show the amount of data behind a chart.
- **Progressive detail:** a simple overview first; let users open methodology, definitions, and raw entries when they want them.
- **Private by default:** no sharing action without a review step; avoid exposing sensitive content in notification previews.
- **Accessible:** strong contrast, readable type, keyboard support, clear focus states, screen-reader labels, and color-independent chart patterns.

### Visual preferences (starting defaults)

- **Palette:** warm off-white, deep teal, and a sharp citron accent. Use color with restraint and avoid pastel washes or gradients.
- **Typography:** highly legible sans serif; use weight and spacing rather than tiny labels or decorative display type.
- **Layout:** mobile-first, card-based but not dashboard-crowded; bottom navigation on mobile and a simple left rail on wider screens.
- **Charts:** simple timeline and range bands, with dates and labels visible. Do not rely on color alone. Avoid defaulting to a flower/calendar metaphor.
- **Tone:** direct, non-judgmental language. Prefer “No pattern is clear yet” over “You need to log more.”
- **Motion and depth:** use restrained layered shadows, small hover movement, and short page transitions. Respect reduced-motion settings.

### Core screens

1. **Today:** quick log action, current personal context, and next relevant timeline item. Do not foreground a single predicted date.
2. **My timeline:** period logs, symptoms, user markers, and confirmed report facts in chronological order.
3. **Cycle patterns:** length ranges, variability over time, and symptom frequency with clear sample sizes and calculation notes.
4. **Add entry:** fast period, symptom, or context entry, with optional notes.
5. **Records:** uploaded documents and confirmed details, with source and date visible.
6. **Appointment summary:** editable preview, date-range selection, and explicit export/share controls.
7. **Privacy and settings:** data export/deletion, notification privacy, and optional tracking categories.

## Safety and trust requirements

- Keep descriptive observations separate from clinical interpretation.
- Do not infer a diagnosis or a causal relationship from co-occurrence.
- Do not label weight, mood, diet, or a symptom as the cause of cycle changes.
- Show how many entries and cycles support an observation; suppress comparisons with too little data.
- Preserve the original uploaded document separately from extracted or user-confirmed details.
- Ask the user to verify extracted dates and terms; make correction and removal straightforward.
- Use neutral copy that directs medical questions to a qualified clinician without inserting generic alarm language everywhere.
- Treat cycle, symptom, and report data as highly sensitive; minimize collection and sharing.

## Success measures

- A new user can record a period without completing optional health profiling.
- Users can understand whether a displayed item is logged, imported, or calculated.
- Users can correct an extraction before it affects any view.
- Users can create and review an appointment summary without losing the underlying sources.
- In usability review, users understand that a before/after comparison is not proof of cause.
- Users with variable cycles do not mistake an uncertain estimate for a guaranteed date.

## Suggested technical shape

For a portfolio-scale full-stack build, keep the first architecture conventional and make the data model trustworthy:

- Responsive web client with reusable accessible components.
- API-backed relational database for users, cycle events, symptoms, context markers, documents, and confirmed extracted facts.
- Private object storage for original documents; store metadata and access rules separately.
- Audit-friendly provenance fields for every imported or calculated item.
- Background document processing only after the manual logging and review flows work.
- Server-side authorization on every record and document request; never rely on hiding UI controls for privacy.

The first build can use seeded sample data and manual report entry. That allows the core experience and interface to be built before choosing an OCR or health-data integration.

## Build roadmap

### Phase 1 — Product foundation

Define the data model, privacy assumptions, navigation, and visual system. Create a clickable flow for onboarding, logging, timeline, pattern view, and summary preview.

### Phase 2 — Useful tracker

Implement accounts, cycle logging/editing, reviewed voice check-ins that create structured events, symptoms, context markers, timeline, and descriptive pattern calculations. Add source labels and calculation explanations from the beginning.

### Phase 3 — Records and summaries

Add private document upload, separate notes and dates for each report, user-controlled summary inclusion, and an editable summary export. Assisted extraction can be evaluated separately after the review flow is useful and trustworthy.

### Phase 4 — Refine with users

Run usability sessions focused on irregular-cycle comprehension, uncertainty, privacy controls, and whether the summary is useful in an appointment. Adjust before adding more predictions or automation.

## Decisions to revisit before implementation

These are defaults for the first prototype, not permanent constraints:

- **Platform:** responsive web app first.
- **Audience:** adults tracking their own cycle; avoid assuming every user identifies as a woman.
- **Privacy:** personal account, private by default, with user-created export only.
- **Visual style:** warm, low-stimulation, data-forward; no pink-only branding.
- **Prediction:** optional and secondary; historical range and change comparison are the primary views.
- **Report ingestion:** manual notes first, then assisted extraction with user confirmation.
