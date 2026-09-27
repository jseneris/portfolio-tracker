// Mirrors isUsMarketOpenNow() in stock-tracker-frontend/src/pages/DashboardPage.tsx; keep the two in sync.
const POST_MARKET_CLOSE_POLLING_BUFFER_MINUTES = 10;

function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function getNthWeekdayOfMonth(year: number, month: number, weekday: number, occurrence: number): number {
  const firstDay = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  return 1 + ((weekday - firstDay + 7) % 7) + (occurrence - 1) * 7;
}

function getLastWeekdayOfMonth(year: number, month: number, weekday: number): number {
  const lastDay = new Date(Date.UTC(year, month, 0));
  return lastDay.getUTCDate() - ((lastDay.getUTCDay() - weekday + 7) % 7);
}

function getObservedFixedHolidayDate(year: number, month: number, day: number): string {
  const date = new Date(Date.UTC(year, month - 1, day));
  const weekday = date.getUTCDay();
  if (weekday === 6) {
    date.setUTCDate(date.getUTCDate() - 1);
  } else if (weekday === 0) {
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return toDateKey(date);
}

function getEasterSunday(year: number): Date {
  const century = Math.floor(year / 100);
  const yearOfCentury = year % 100;
  const centuryRemainder = year % 19;
  const centuryCorrection = Math.floor(century / 4);
  const yearCorrection = century % 4;
  const moonCorrection = Math.floor((century + 8) / 25);
  const moonCycleCorrection = Math.floor((century - moonCorrection + 1) / 3);
  const epact = (19 * centuryRemainder + century - centuryCorrection - moonCycleCorrection + 15) % 30;
  const weekdayCorrection = Math.floor(yearOfCentury / 4);
  const yearWeekdayCorrection = yearOfCentury % 4;
  const daysToEaster = (32 + 2 * yearCorrection + 2 * weekdayCorrection - epact - yearWeekdayCorrection) % 7;
  const month = Math.floor((centuryRemainder + 11 * epact + 22 * daysToEaster) / 451);
  const easterMonth = Math.floor((epact + daysToEaster - 7 * month + 114) / 31);
  const easterDay = ((epact + daysToEaster - 7 * month + 114) % 31) + 1;
  return new Date(Date.UTC(year, easterMonth - 1, easterDay));
}

function getUsMarketClosures(year: number): { fullDay: Set<string>; earlyClose: Set<string> } {
  const fullDay = new Set([
    getObservedFixedHolidayDate(year, 1, 1),
    `${year}-01-${String(getNthWeekdayOfMonth(year, 1, 1, 3)).padStart(2, '0')}`,
    `${year}-02-${String(getNthWeekdayOfMonth(year, 2, 1, 3)).padStart(2, '0')}`,
    toDateKey(new Date(getEasterSunday(year).getTime() - 2 * 24 * 60 * 60 * 1000)),
    `${year}-05-${String(getLastWeekdayOfMonth(year, 5, 1)).padStart(2, '0')}`,
    getObservedFixedHolidayDate(year, 6, 19),
    getObservedFixedHolidayDate(year, 7, 4),
    `${year}-09-${String(getNthWeekdayOfMonth(year, 9, 1, 1)).padStart(2, '0')}`,
    `${year}-11-${String(getNthWeekdayOfMonth(year, 11, 4, 4)).padStart(2, '0')}`,
    getObservedFixedHolidayDate(year, 12, 25),
  ]);

  const thanksgivingDay = getNthWeekdayOfMonth(year, 11, 4, 4);
  const earlyClose = new Set([
    `${year}-11-${String(thanksgivingDay + 1).padStart(2, '0')}`,
    getObservedFixedHolidayDate(year, 12, 24),
  ]);

  return { fullDay, earlyClose };
}

export function isUsMarketOpen(now: Date = new Date()): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour12: false,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(now);

  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const isWeekday = lookup.weekday !== 'Sat' && lookup.weekday !== 'Sun';
  const dateKey = `${lookup.year}-${lookup.month}-${lookup.day}`;
  const closures = getUsMarketClosures(Number(lookup.year));
  // Intl can emit hour "24" for midnight with hour12:false.
  const hour = Number(lookup.hour) % 24;
  const minutesSinceMidnight = hour * 60 + Number(lookup.minute);
  const closingMinutes = closures.earlyClose.has(dateKey) ? 13 * 60 : 16 * 60;

  return isWeekday
    && !closures.fullDay.has(dateKey)
    && minutesSinceMidnight >= 9 * 60 + 30
    && minutesSinceMidnight < closingMinutes + POST_MARKET_CLOSE_POLLING_BUFFER_MINUTES;
}
