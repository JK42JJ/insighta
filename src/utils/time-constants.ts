export const MS_PER_SECOND = 1_000;
export const SECONDS_PER_MINUTE = 60;
export const MINUTES_PER_HOUR = 60;
export const HOURS_PER_DAY = 24;

export const MS_PER_MINUTE = MS_PER_SECOND * SECONDS_PER_MINUTE;
export const MS_PER_HOUR = MS_PER_MINUTE * MINUTES_PER_HOUR;
export const MS_PER_DAY = MS_PER_HOUR * HOURS_PER_DAY;

export const DAYS_PER_MONTH_AVG = 30;
export const MS_PER_MONTH_AVG = MS_PER_DAY * DAYS_PER_MONTH_AVG;

export function daysToMs(days: number): number {
  return days * MS_PER_DAY;
}
