export const addDays = (date: Date, count: number) => new Date(date.getTime() + count * 86400_000);
export function addMonths(date: Date, count: number) { const next = new Date(date); next.setUTCMonth(next.getUTCMonth() + count); return next; }
export function addYears(date: Date, count: number) { const next = new Date(date); next.setUTCFullYear(next.getUTCFullYear() + count); return next; }
