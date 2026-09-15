export const addDays = (date: Date, count: number) => new Date(date.getTime() + count * 86400_000);
