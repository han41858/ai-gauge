const formatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Seoul', calendar: 'gregory', numberingSystem: 'latn',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  hourCycle: 'h23'
});

export function buildVersion(date = new Date()) {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) throw new RangeError('Invalid build date');
  const parts = Object.fromEntries(formatter.formatToParts(date).map(({ type, value }) => [type, value]));
  if (!/^\d{4}$/.test(parts.year) || Number(parts.year) < 1000) throw new RangeError('Build year must have four digits');
  const { year, month, day, hour, minute } = parts;
  return {
    version: [year, month, day, `${hour}${minute}`].map(Number).join('.'),
    version_name: `${year}${month}${day}${hour}${minute}`
  };
}
