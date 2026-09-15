export const BUSINESS_TIME_ZONE = 'Asia/Dhaka'

const DHAKA_UTC_OFFSET = '+06:00'
const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/

export function isValidDateKey(value: string): boolean {
  const match = DATE_KEY_PATTERN.exec(value)
  if (!match)
    return false

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const candidate = new Date(Date.UTC(year, month - 1, day))

  return candidate.getUTCFullYear() === year
    && candidate.getUTCMonth() === month - 1
    && candidate.getUTCDate() === day
}

function assertValidDateKey(dateKey: string): void {
  if (!isValidDateKey(dateKey))
    throw new RangeError('Invalid date key; expected a real date in YYYY-MM-DD format')
}

export function timeToMinutes(time: string): number {
  const match = TIME_PATTERN.exec(time)
  if (!match)
    throw new RangeError('Invalid time; expected HH:mm in 24-hour format')

  return Number(match[1]) * 60 + Number(match[2])
}

export function addDaysToDateKey(dateKey: string, days: number): string {
  assertValidDateKey(dateKey)
  if (!Number.isInteger(days))
    throw new RangeError('Days must be an integer')

  const [year, month, day] = dateKey.split('-').map(Number)
  const result = new Date(Date.UTC(year, month - 1, day + days))

  return [
    result.getUTCFullYear().toString().padStart(4, '0'),
    (result.getUTCMonth() + 1).toString().padStart(2, '0'),
    result.getUTCDate().toString().padStart(2, '0'),
  ].join('-')
}

export function dhakaDateStart(dateKey: string): Date {
  assertValidDateKey(dateKey)
  return new Date(`${dateKey}T00:00:00.000${DHAKA_UTC_OFFSET}`)
}

export function getDhakaDayRange(dateKey: string): { start: Date, endExclusive: Date } {
  return {
    start: dhakaDateStart(dateKey),
    endExclusive: dhakaDateStart(addDaysToDateKey(dateKey, 1)),
  }
}

export function getDhakaDateKey(date: Date = new Date()): string {
  if (Number.isNaN(date.getTime()))
    throw new RangeError('Invalid date')

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)

  const year = parts.find(part => part.type === 'year')?.value
  const month = parts.find(part => part.type === 'month')?.value
  const day = parts.find(part => part.type === 'day')?.value

  if (!year || !month || !day)
    throw new Error('Unable to format date in the business timezone')

  return `${year}-${month}-${day}`
}

export function getDhakaWeekday(dateKey: string): number {
  assertValidDateKey(dateKey)
  return new Date(`${dateKey}T00:00:00.000Z`).getUTCDay()
}

export function dhakaDateTimeToInstant(dateKey: string, time: string): Date {
  assertValidDateKey(dateKey)
  timeToMinutes(time)
  return new Date(`${dateKey}T${time}:00.000${DHAKA_UTC_OFFSET}`)
}

export function isDhakaSlotInPast(
  dateKey: string,
  startTime: string,
  now: Date = new Date(),
): boolean {
  if (Number.isNaN(now.getTime()))
    throw new RangeError('Invalid current date')

  return dhakaDateTimeToInstant(dateKey, startTime).getTime() <= now.getTime()
}
