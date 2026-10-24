const normalize = (value: string) => (value || '').trim().replace(/\s+/g, ' ').toUpperCase();
const aliases: Record<string, string> = {
  TABLET: 'TAB', TABLETS: 'TAB', SYRUP: 'SYP', CAPSULE: 'CAP', CAPSULES: 'CAP',
  SUSPENSION: 'SUS', 'ORAL SUSPENSION': 'ORAL SUS', 'ORAL SOLUTION': 'ORAL SOL',
  'EYE DROPS': 'EYE DROP', 'OPHTHALMIC DROP': 'EYE DROP', 'OPHTHALMIC DROPS': 'EYE DROP',
  'EAR DROPS': 'EAR DROP', 'NASAL DROPS': 'NASAL DROP',
  'EYE OINTMENT': 'EYE OINT', 'OPHTHALMIC OINTMENT': 'EYE OINT',
};
export const normalizePreparation = (form: string) => aliases[normalize(form)] || normalize(form) || 'UNKNOWN';
export const preparationKey = (generic: string, brand: string, company: string, form: string) =>
  [...[generic, brand, company].map(normalize), normalizePreparation(form)].join('\u001f');

// Only explicit dosage forms establish a route. A bare DROP/SOL remains separate.
export function preparationMarket(form: string): string {
  const value = normalizePreparation(form);
  if (/^(EYE |OPHTHALMIC )/.test(value)) return 'EYE';
  if (/^EAR /.test(value)) return 'EAR';
  if (/^NASAL /.test(value)) return 'NASAL';
  if (/^(INH|NEBU|SPACER)/.test(value)) return 'INHALED';
  if (/^(IV|IM|INJ|SOL FOR INJ|SOL FOR INF)/.test(value)) return 'INJECTION';
  if (/^(RECTAL |SUP$)/.test(value)) return 'RECTAL';
  if (/^VAGINAL /.test(value)) return 'VAGINAL';
  if (/^(ORAL |TAB$|CAP$|SYP$|SUS$|SOFT CAP$|ELIXIR$|ORS$|SACHET$)/.test(value)) return 'ORAL';
  if (/^(CREAM|OINT|GEL|LOTION|SHAMPOO|HAND RUB)$/.test(value)) return 'TOPICAL';
  return 'FORM:' + value;
}
const labels: Record<string, string> = { TAB: 'Tablet', SYP: 'Syrup', CAP: 'Capsule', SUS: 'Suspension', UNKNOWN: 'Form unavailable' };
export function preparationLabel(forms: string[]) {
  const order = ['TAB', 'CAP', 'SOFT CAP', 'SYP', 'SUS', 'ORAL SUS'];
  const rank = (form: string) => order.includes(form) ? order.indexOf(form) : order.length;
  return [...new Set(forms.map(normalizePreparation))].sort((a,b) => rank(a) - rank(b) || a.localeCompare(b)).map(form => labels[form] || form.toLowerCase().replace(/(^|\s)\S/g, v => v.toUpperCase())).join(' + ');
}
