// Use the same finite separator set for request and stored-phone normalization.
export const PHONE_SEPARATORS = [' ', '\t', '\r', '\n', '-', '(', ')'] as const

export function normalizeBangladeshPhone(phone: string): string | null {
  if (phone.length > 64) return null
  let compact = phone
  for (const separator of PHONE_SEPARATORS) compact = compact.split(separator).join('')
  if (/^\+?8801[0-9]{9}$/.test(compact)) compact = `0${compact.replace(/^\+?880/, '')}`
  return /^01[0-9]{9}$/.test(compact) ? compact : null
}

// Exact comparisons after separator removal; no regex or substring matching.
export function storedPhoneLookupFilter(canonicalPhone: string): object {
  if (!/^01[0-9]{9}$/.test(canonicalPhone)) throw new Error('Invalid canonical phone')
  let input: object = { $cond: [{ $eq: [{ $type: '$phone' }, 'string'] }, '$phone', ''] }
  for (const separator of PHONE_SEPARATORS) {
    input = { $replaceAll: { input, find: separator, replacement: '' } }
  }
  return { $expr: { $in: [input, [canonicalPhone, `88${canonicalPhone}`, `+88${canonicalPhone}`]] } }
}
