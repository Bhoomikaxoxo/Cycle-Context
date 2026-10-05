export const symptomTerms = [
  ['Cramps', ['cramps', 'cramp', 'crampy']],
  ['Pelvic discomfort', ['pelvic discomfort', 'pelvic pain']],
  ['Pain', ['pain', 'aching', 'ache', 'sore']],
  ['Headache', ['headache', 'migraine']],
  ['Lower energy', ['low energy', 'tired', 'fatigue', 'exhausted']],
  ['Mood changes', ['mood swings', 'mood change', 'irritable', 'anxious', 'sad']],
  ['Sleep changes', ['sleep changes', 'insomnia', 'poor sleep', 'slept']],
  ['Bloating', ['bloating', 'bloated', 'bloat']],
  ['Nausea', ['nausea', 'nauseous', 'vomiting']],
  ['Spotting', ['spotting']],
  ['Heavy bleeding', ['heavy bleeding', 'heavy flow']],
  ['Back pain', ['backache', 'back pain']],
  ['Breast tenderness', ['breast tenderness', 'tender breasts']],
  ['Dizziness', ['dizzy', 'dizziness']],
  ['Acne', ['acne', 'breakout']]
];

export function localISODate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function parseDay(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function dateFromDayOffset(days, refDate) {
  const date = refDate ? parseDay(refDate) : new Date();
  date.setDate(date.getDate() + days);
  return localISODate(date);
}

export function namedMonthDate(monthName, day, year, refDate) {
  const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const month = monthNames.findIndex(prefix => monthName.toLowerCase().startsWith(prefix)) + 1;
  if (month === 0) return null;
  const currentYear = year ? Number(year) : (refDate ? parseDay(refDate).getFullYear() : new Date().getFullYear());
  const date = new Date(currentYear, month - 1, Number(day), 12);
  if (date.getMonth() !== month - 1) return null;
  return localISODate(date);
}

export function bareDayOfMonth(dayNumber, refDate) {
  const base = refDate ? parseDay(refDate) : new Date();
  const targetDay = Number(dayNumber);
  if (isNaN(targetDay) || targetDay < 1 || targetDay > 31) return null;
  // Try current month:
  let candidate = new Date(base.getFullYear(), base.getMonth(), targetDay, 12);
  // Pinned convention: must be strictly before refDate
  if (localISODate(candidate) >= localISODate(base)) {
    candidate = new Date(base.getFullYear(), base.getMonth() - 1, targetDay, 12);
  }
  return localISODate(candidate);
}

export function weekdayDate(text, refDate) {
  const match = text.match(/\b(last\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i);
  if (!match) return null;
  const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const target = weekdays.indexOf(match[2].toLowerCase());
  const base = refDate ? parseDay(refDate) : new Date();
  let difference = target - base.getDay();
  // By pinned convention: strictly before refDate
  if (difference >= 0) difference -= 7;
  const date = new Date(base);
  date.setDate(date.getDate() + difference);
  return localISODate(date);
}

export function extractDateMentions(text, refDate) {
  const mentions = [];
  const ref = refDate || localISODate();
  const patterns = [
    { type: 'relative', regex: /\bday before yesterday\b/gi, resolve: () => dateFromDayOffset(-2, ref) },
    { type: 'relative', regex: /\b(one|two|three|four|five|six|seven)\s+days?\s+ago\b/gi, resolve: match => dateFromDayOffset(-({ one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 }[match[1].toLowerCase()]), ref) },
    { type: 'relative', regex: /\b(\d+)\s+days?\s+ago\b/gi, resolve: match => dateFromDayOffset(-Number(match[1]), ref) },
    { type: 'relative', regex: /\b(yesterday|last night)\b/gi, resolve: () => dateFromDayOffset(-1, ref) },
    { type: 'relative', regex: /\b(today|this morning|this afternoon|tonight)\b/gi, resolve: () => ref },
    { type: 'relative', regex: /\b(last\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi, resolve: match => weekdayDate(match[0], ref) },
    { type: 'explicit', regex: /\b(\d{4})-(\d{2})-(\d{2})\b/g, resolve: match => `${match[1]}-${match[2]}-${match[3]}` },
    { type: 'explicit', regex: /\bthe\s+(\d{1,2})(?:st|nd|rd|th)?\s+of\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\s+(\d{4}))?\b/gi,
      resolve: match => namedMonthDate(match[2], match[1], match[3], ref) },
    { type: 'explicit', regex: /\b(?:on\s+)?(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/gi,
      resolve: match => namedMonthDate(match[1], match[2], match[3], ref) },
    { type: 'explicit', regex: /\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\s+(\d{4}))?\b/gi,
      resolve: match => namedMonthDate(match[2], match[1], match[3], ref) },
    { type: 'explicit', regex: /\b(?:on\s+)?the\s+(\d{1,2})(?:st|nd|rd|th)?\b/gi, resolve: match => bareDayOfMonth(match[1], ref) }
  ];

  patterns.forEach(({ type, regex, resolve }) => {
    for (const match of text.matchAll(regex)) {
      const date = resolve(match);
      if (date) mentions.push({ index: match.index, date, length: match[0].length, type });
    }
  });

  // Filter overlapping spans: keep earliest/longest
  const filtered = mentions.sort((a, b) => a.index - b.index).filter((mention, index, list) =>
    !list.slice(0, index).some(previous => mention.index < previous.index + previous.length));

  // Handle self-corrections:
  // e.g. "Wednesday, actually no, Thursday" or "Friday... wait no, on Saturday"
  // If a retraction phrase appears between mention A and mention B, drop mention A.
  const retractionRegex = /\b(?:actually\s+no|no\s+wait|wait\s+no|wait\s*,?\s*I\s+mean|wait)\b/i;
  const pruned = [];
  for (let i = 0; i < filtered.length; i++) {
    const cur = filtered[i];
    const next = filtered[i + 1];
    if (next) {
      const between = text.slice(cur.index + cur.length, next.index);
      if (retractionRegex.test(between)) {
        // Drop cur because next is the speaker's self-correction
        continue;
      }
    }
    pruned.push(cur);
  }

  return pruned;
}

// Split text into clause units while tracking character offsets
export function getClauses(text) {
  const clauses = [];
  const splitRegex = /([,;.\n]|(?:\s+(?:and\s+then|and|then|but|while)\s+))/gi;
  let start = 0;
  let match;
  while ((match = splitRegex.exec(text)) !== null) {
    if (match.index > start) {
      clauses.push({ text: text.slice(start, match.index), start, end: match.index });
    }
    start = match.index + match[0].length;
  }
  if (start < text.length) {
    clauses.push({ text: text.slice(start), start, end: text.length });
  }
  return clauses;
}

export function nearestClauseDate(matchIndex, matchLength, mentions, clauses, fallback) {
  if (!mentions.length) return { date: fallback, dateSource: 'defaulted' };

  const matchEnd = matchIndex + matchLength;

  // 1. Check if a date mention is inside the same clause
  const clause = clauses.find(c => matchIndex >= c.start && matchIndex <= c.end);
  if (clause) {
    const clauseMentions = mentions.filter(m => m.index >= clause.start && m.index <= clause.end);
    if (clauseMentions.length) {
      const best = clauseMentions.reduce((b, m) =>
        Math.abs(m.index - matchIndex) < Math.abs(b.index - matchIndex) ? m : b, clauseMentions[0]);
      return { date: best.date, dateSource: best.type || 'relative' };
    }
  }

  // 2. Check if a date mention overlaps with the match span
  const overlapping = mentions.find(m => m.index >= matchIndex - 5 && m.index <= matchEnd);
  if (overlapping) return { date: overlapping.date, dateSource: overlapping.type || 'relative' };

  // 3. Check trailing date within the immediate vicinity
  const trailing = mentions.find(m => m.index >= matchEnd && (m.index - matchEnd) <= 35);
  if (trailing) return { date: trailing.date, dateSource: trailing.type || 'relative' };

  // 4. Fallback to nearest date mention overall (cross-clause inference)
  const nearest = mentions.reduce((b, m) =>
    Math.abs(m.index - matchIndex) < Math.abs(b.index - matchIndex) ? m : b, mentions[0]);
  return { date: nearest ? nearest.date : fallback, dateSource: nearest ? 'inferred' : 'defaulted' };
}

// Check if a symptom or event at matchIndex is negated in its clause
export function isNegated(text, matchIndex) {
  // Look back in text up to clause boundary (comma, period, semicolon, but, except)
  const prefix = text.slice(0, matchIndex);
  const boundaryMatch = prefix.match(/[,;.\n]|\b(?:but|however|except|although)\b/gi);
  const clauseStart = boundaryMatch ? prefix.lastIndexOf(boundaryMatch[boundaryMatch.length - 1]) + boundaryMatch[boundaryMatch.length - 1].length : 0;
  const preceding = text.slice(clauseStart, matchIndex).toLowerCase();

  // Check for negation keywords
  const negKeywordMatch = preceding.match(/\b(no|not|never|without|zero|neither|nor|haven't|havent|have\s+not)\b/i);
  if (!negKeywordMatch) return false;

  const afterNeg = preceding.slice(negKeywordMatch.index + negKeywordMatch[0].length);

  // If there's an intervening contrast word after negation, it's not negated
  if (/\b(but|however|except)\b/i.test(afterNeg)) return false;

  // Words allowed between negation and the target term:
  // light verbs, adverbs, determiners, prepositions, or a coordinated noun phrase (e.g. "headaches or")
  const clean = afterNeg.replace(/\b(?:any|more|real|really|much|at\s+all|definite|definitely|feeling|feel|felt|having|have|had|experiencing|experienced|notice|noticed|seen|see|to\s+report)\b/gi, ' ')
    .replace(/[a-z\s]+?\s+(?:or|nor|and)\s+/gi, ' ')
    .trim();

  return clean.length === 0 || /^[,;\s]*$/.test(clean);
}

export function parseVoiceEvents(text, refDate) {
  const ref = refDate || localISODate();
  const dateMentions = extractDateMentions(text, ref);
  const fallbackDate = dateMentions[0]?.date || weekdayDate(text, ref) || ref;
  const clauses = getClauses(text);
  const rawMatches = [];

  const addMatch = (index, length, kind, title) => {
    rawMatches.push({ index, length, kind, title });
  };

  // 1. Period start phrases
  const startRegex = /\b(?:my\s+)?period\s+(?:has\s+)?(?:started|began)\b|\b(?:started|began)\s+(?:my\s+)?period\b|\bstarted\s+bleeding\b|\bbleeding\s+(?:has\s+)?(?:started|began)\b|\bgot\s+my\s+period\b|\bperiod\s+came\b/gi;
  for (const m of text.matchAll(startRegex)) {
    if (!isNegated(text, m.index)) {
      addMatch(m.index, m[0].length, 'period-start', 'Period started');
    }
  }

  // 2. Period end phrases
  const endRegex = /\b(?:my\s+)?period\s+(?:has\s+)?(?:ended|stopped|finished)\b|\b(?:ended|stopped|finished)\s+(?:my\s+)?period\b|\bbleeding\s+(?:has\s+)?(?:ended|stopped|ceased)\b|\bfinished\s+bleeding\b|\bstopped\s+bleeding\b|\bbleeding\s+has\s+stopped\b|\bwrapped\s+up\b/gi;
  for (const m of text.matchAll(endRegex)) {
    if (!isNegated(text, m.index)) {
      addMatch(m.index, m[0].length, 'period-end', 'Period ended');
    }
  }

  // 3. Conjunction / secondary period predicates
  // e.g. "started on Oct 1 and ended on Oct 4", "began on Oct 2, ended Oct 5", "started Monday, finished Thursday"
  if (rawMatches.some(m => m.kind === 'period-start') || /\b(?:period|bleeding)\b/i.test(text)) {
    const secondaryEndRegex = /\b(?:and\s+|then\s+)?(?:it\s+)?(?:ended|finished|stopped|ceased|wrapped\s+up)\b/gi;
    for (const m of text.matchAll(secondaryEndRegex)) {
      if (!rawMatches.some(existing => Math.abs(existing.index - m.index) < 10 && existing.kind === 'period-end') && !isNegated(text, m.index)) {
        addMatch(m.index, m[0].length, 'period-end', 'Period ended');
      }
    }
  }

  // Also handle bare "started on..." / "began on..." when no other period-start matched
  if (!rawMatches.some(m => m.kind === 'period-start')) {
    const bareStartRegex = /\b(?:started|began)\s+(?:on\s+)?(?:the\s+\d{1,2}|\d{1,2}|monday|tuesday|wednesday|thursday|friday|saturday|sunday|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/gi;
    for (const m of text.matchAll(bareStartRegex)) {
      if (!isNegated(text, m.index)) {
        addMatch(m.index, m[0].length, 'period-start', 'Period started');
        break;
      }
    }
    // And if bare start matched, look for bare finished/ended
    if (rawMatches.some(m => m.kind === 'period-start')) {
      const bareEndRegex = /\b(?:and\s+)?(?:finished|ended|stopped)\s+(?:on\s+)?(?:the\s+\d{1,2}|\d{1,2}|monday|tuesday|wednesday|thursday|friday|saturday|sunday|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/gi;
      for (const m of text.matchAll(bareEndRegex)) {
        if (!isNegated(text, m.index)) {
          addMatch(m.index, m[0].length, 'period-end', 'Period ended');
          break;
        }
      }
    }
  }

  // 4. Context phrases
  const medicationRegex = /\b(?:started|changed|stopped|increased|decreased)\s+(?:taking\s+)?(?:a\s+new\s+|my\s+)?medication\b|\bmedication\s+(?:change|changed)\b|\bchanged\s+medication\b/gi;
  for (const m of text.matchAll(medicationRegex)) {
    addMatch(m.index, m[0].length, 'context', 'Medication change');
  }

  const routineRegex = /\b(?:routine|schedule|workout|exercise)\s+(?:change|changed|shifted)\b/gi;
  for (const m of text.matchAll(routineRegex)) {
    addMatch(m.index, m[0].length, 'context', 'Routine change');
  }

  // 5. Symptoms with longest-match subsumption before negation check
  const allCandidateSymptoms = [];
  symptomTerms.forEach(([title, terms]) => {
    terms.forEach(term => {
      const regex = new RegExp(`\\b${term}\\b`, 'gi');
      for (const m of text.matchAll(regex)) {
        allCandidateSymptoms.push({
          index: m.index,
          length: m[0].length,
          end: m.index + m[0].length,
          kind: 'symptom',
          title
        });
      }
    });
  });

  // Longest-match subsumption: eliminate shorter sub-spans (e.g. "pain" inside "back pain")
  const nonSubsumedSymptoms = allCandidateSymptoms.filter(candidate => {
    const isSubsumed = allCandidateSymptoms.some(other =>
      other !== candidate &&
      other.index <= candidate.index &&
      other.end >= candidate.end &&
      other.length > candidate.length
    );
    return !isSubsumed;
  });

  // Now apply negation filtering only to the winning longest terms
  const validSymptoms = nonSubsumedSymptoms.filter(s => !isNegated(text, s.index));
  validSymptoms.forEach(s => addMatch(s.index, s.length, s.kind, s.title));

  // Sort all raw matches by index
  rawMatches.sort((a, b) => a.index - b.index);

  // Deduplicate and assign dates
  const events = [];
  rawMatches.forEach(match => {
    if (events.some(e => e.kind === match.kind && e.title === match.title)) return;
    const res = nearestClauseDate(match.index, match.length, dateMentions, clauses, fallbackDate);
    events.push({ ...match, date: res.date, dateSource: res.dateSource });
  });

  return events.length ? events : [{ kind: 'note', title: 'General note', date: fallbackDate, dateSource: 'defaulted' }];
}
