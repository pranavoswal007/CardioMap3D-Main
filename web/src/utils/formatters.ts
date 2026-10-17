export function formatNumericDefault(val: unknown): string {
  if (val === undefined || val === null || val === '') return '';
  if (typeof val === 'number') {
    return Number(val.toFixed(1)).toString();
  }
  const num = Number(val);
  if (!isNaN(num)) {
    return Number(num.toFixed(1)).toString();
  }
  return String(val);
}
