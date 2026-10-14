export const COMMON_MEDICATION_PRESETS = [
  {
    name: 'Myo-Inositol',
    category: 'supplement',
    defaultDosage: '2,000 mg',
    defaultFrequency: 'Twice daily',
    notes: '40:1 Myo to D-Chiro ratio for insulin sensitivity and ovulatory support'
  },
  {
    name: 'Metformin',
    category: 'medication',
    defaultDosage: '500 mg',
    defaultFrequency: 'Once daily with dinner',
    notes: 'Prescribed for cycle regularity and insulin sensitivity'
  },
  {
    name: 'Combined Oral Contraceptive',
    category: 'medication',
    defaultDosage: '1 tablet',
    defaultFrequency: 'Daily at the same time',
    notes: 'Hormonal cycle management'
  },
  {
    name: 'Levothyroxine',
    category: 'medication',
    defaultDosage: '50 mcg',
    defaultFrequency: 'Once daily on empty stomach (30m before breakfast)',
    notes: 'Thyroid function support (TSH optimization)'
  },
  {
    name: 'Spironolactone',
    category: 'medication',
    defaultDosage: '50 mg',
    defaultFrequency: 'Once daily',
    notes: 'Androgen receptor blocker'
  },
  {
    name: 'Vitamin D3',
    category: 'supplement',
    defaultDosage: '2,000 IU',
    defaultFrequency: 'Daily with meal',
    notes: 'Immune, follicular, and bone metabolic support'
  },
  {
    name: 'Micronized Progesterone',
    category: 'medication',
    defaultDosage: '200 mg',
    defaultFrequency: 'Daily during luteal phase (Days 14–28)',
    notes: 'Luteal phase support and endometrial protection'
  },
  {
    name: 'Iron (Elemental / Bisglycinate)',
    category: 'supplement',
    defaultDosage: '65 mg',
    defaultFrequency: 'Every other day with Vitamin C',
    notes: 'Support for low ferritin and menstrual blood loss'
  },
  {
    name: 'Omega-3 Fish Oil',
    category: 'supplement',
    defaultDosage: '1,000 mg',
    defaultFrequency: 'Daily with food',
    notes: 'Anti-inflammatory and lipid support'
  }
];

export function calculateRegimenDuration(startDate, endDate = null, asOfDate = new Date().toISOString().slice(0, 10)) {
  if (!startDate) return { days: 0, label: 'No start date', isActive: false };

  const startMs = Date.parse(`${startDate}T12:00:00`);
  if (isNaN(startMs)) return { days: 0, label: 'Invalid date', isActive: false };

  const effectiveEnd = endDate && endDate.trim() ? endDate : asOfDate;
  const endMs = Date.parse(`${effectiveEnd}T12:00:00`);
  if (isNaN(endMs)) return { days: 0, label: 'Invalid end date', isActive: false };

  const diffMs = Math.max(0, endMs - startMs);
  const days = Math.round(diffMs / 86400000);
  const isActive = !endDate || endDate.trim() === '' || endDate >= asOfDate;

  let durationText = '';
  if (days === 0) {
    durationText = 'Started today';
  } else if (days < 7) {
    durationText = `${days} day${days === 1 ? '' : 's'}`;
  } else if (days < 60) {
    const weeks = Math.round(days / 7);
    durationText = `${days} days (~${weeks} wk${weeks === 1 ? '' : 's'})`;
  } else {
    const months = (days / 30.4).toFixed(1);
    durationText = `${days} days (~${months} mos)`;
  }

  const label = isActive
    ? `Active · ${durationText}`
    : `Completed · ${durationText}`;

  return { days, durationText, label, isActive };
}

export function formatRegimenLine(med, asOfDate = new Date().toISOString().slice(0, 10)) {
  if (!med) return '';
  const duration = calculateRegimenDuration(med.startDate, med.endDate, asOfDate);
  const parts = [];
  if (med.dosage) parts.push(med.dosage);
  if (med.frequency) parts.push(med.frequency);
  const details = parts.length ? ` (${parts.join(', ')})` : '';

  const statusStr = med.status === 'paused'
    ? 'Paused'
    : (duration.isActive ? 'Active' : 'Completed');

  const dateContext = med.endDate
    ? `${med.startDate} to ${med.endDate}`
    : `Since ${med.startDate}`;

  return `• ${med.name}${details} — [${statusStr}] ${dateContext} (${duration.durationText})${med.notes ? ` · ${med.notes}` : ''}`;
}

export function filterMedicationsByWindow(medications, minDate = null, maxDate = null) {
  if (!Array.isArray(medications)) return [];
  if (!minDate && !maxDate) return [...medications];

  return medications.filter(med => {
    const start = med.startDate || '1970-01-01';
    const end = med.endDate && med.endDate.trim() ? med.endDate : '9999-12-31';

    // Overlap condition: start <= maxDate AND end >= minDate
    const afterStart = !minDate || end >= minDate;
    const beforeEnd = !maxDate || start <= maxDate;
    return afterStart && beforeEnd;
  });
}

export function filterMedicationsByStatus(medications, status = 'all') {
  if (!Array.isArray(medications)) return [];
  if (status === 'all') return [...medications];
  return medications.filter(m => (m.status || 'active') === status);
}
