// Run with node tests/bookingLookup.cjs. Database reads are mocked; no server or DB needed.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { EventEmitter } = require('node:events')
const ts = require('typescript')
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(
  fs.readFileSync(file, 'utf8'),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } },
).outputText, file)

const { normalizeBangladeshPhone, storedPhoneLookupFilter } = require('../src/utils/phone.ts')
const { lookupBookingSchema, lookupBookingPaginationSchema } = require('../src/schemas/bookingSchema.ts')
const phone = '01700000000'
const accepted = [phone, '8801700000000', '+8801700000000', ' +880 (170) 000-0000 ', '(017) 000-00000']
for (const value of accepted) assert.equal(normalizeBangladeshPhone(value), phone)
const rejected = ['', '123', '+01700000000', '01700000000x', '017000000001', '88001700000000', '017.00000000']
for (const value of rejected) assert.equal(normalizeBangladeshPhone(value), null)
for (const value of [{}, { phone: 123 }, { phone: {} }, { phone: 'invalid' }]) assert.equal(lookupBookingSchema.safeParse(value).success, false)
for (const value of [{ limit: 51 }, { page: 1001 }, { limit: 0 }, { page: 1.5 }]) assert.equal(lookupBookingPaginationSchema.safeParse(value).success, false)
assert.deepEqual(lookupBookingPaginationSchema.parse({}), { page: 1, limit: 10 })

// Evaluate the limited expression tree to verify exact legacy equivalence and rejection.
function evaluate(value, stored) {
  if (value === '$phone') return stored
  if (Array.isArray(value)) return value.map(item => evaluate(item, stored))
  if (!value || typeof value !== 'object') return value
  if ('$type' in value) return typeof stored === 'string' ? 'string' : 'other'
  if ('$eq' in value) { const [a, b] = evaluate(value.$eq, stored); return a === b }
  if ('$cond' in value) { const [condition, yes, no] = value.$cond; return evaluate(evaluate(condition, stored) ? yes : no, stored) }
  if ('$replaceAll' in value) { const { input, find, replacement } = value.$replaceAll; return evaluate(input, stored).split(find).join(replacement) }
  if ('$in' in value) { const [item, options] = evaluate(value.$in, stored); return options.includes(item) }
  throw new Error('Unexpected lookup operator')
}
const filter = storedPhoneLookupFilter(phone)
for (const value of accepted) assert.equal(evaluate(filter.$expr, value), true)
for (const value of [...rejected, '01700000001', null, 1700000000]) assert.equal(evaluate(filter.$expr, value), false)

const { User } = require('../src/models/User.ts')
const { Booking } = require('../src/models/Booking.ts')
let empty = false
User.find = actual => {
  assert.deepEqual(actual, filter)
  return { select: projection => { assert.equal(projection, '_id'); return { lean: async () => empty ? [] : [{ _id: 'a' }, { _id: 'b' }] } } }
}
const rows = ['pending', 'confirmed', 'cancelled'].map(status => ({
  _id: status, turf: { name: 'Venue', location: { city: 'City', private: 'SECRET' }, admins: ['SECRET'] },
  facility: { name: 'Pitch', pricingRules: ['SECRET'] }, date: new Date('2026-10-04T18:00:00Z'),
  startTime: '10:00', endTime: '11:00', status, paymentStatus: 'pending_approval',
  user: 'SECRET', transactionId: 'SECRET', lastDigit: 'SECRET',
}))
let skip, limit
Booking.find = actual => {
  assert.deepEqual(actual, { user: { $in: ['a', 'b'] } })
  const query = { select() { return query }, populate() { return query }, sort() { return query },
    skip(value) { skip = value; return query }, limit(value) { limit = value; return query }, lean: async () => rows }
  return query
}
Booking.countDocuments = async () => 3
function response() {
  const res = new EventEmitter()
  res.headers = {}
  res.setHeader = (key, value) => { res.headers[key.toLowerCase()] = value }
  res.getHeader = key => res.headers[key.toLowerCase()]
  res.status = code => { res.statusCode = code; return res }
  res.json = body => { res.body = body; res.done?.(); return res }
  res.send = res.json
  return res
}
function invoke(handler, req, res) {
  return new Promise((resolve, reject) => {
    res.done = resolve
    handler(req, res, error => error ? reject(error) : resolve())
  })
}
async function main() {
  const { lookupBookingsByPhone } = require('../src/services/bookingServices.ts')
  const result = await lookupBookingsByPhone(phone, 2, 10)
  assert.equal(skip, 10); assert.equal(limit, 10)
  assert.equal(result.bookings.length, 3)
  for (const booking of result.bookings) {
    assert.deepEqual(Object.keys(booking).sort(), ['bookingId', 'turfName', 'facilityName', 'venueLocation', 'date', 'startTime', 'endTime', 'status', 'paymentStatus'].sort())
    assert.equal(booking.date, '2026-10-05'); assert.equal(booking.paymentStatus, 'pending')
  }
  assert.equal(JSON.stringify(result).includes('SECRET'), false)
  rows[0].turf = null; rows[0].facility = null
  const missingVenue = (await lookupBookingsByPhone(phone, 1, 10)).bookings[0]
  assert.equal(missingVenue.turfName, null); assert.equal(missingVenue.facilityName, null)
  empty = true
  const router = require('../src/routes/bookingRoutes.ts').default
  const route = router.stack.find(layer => layer.route?.path === '/lookup').route
  assert.equal(route.methods.post, true)
  assert.equal(route.stack.length, 3) // no requireAuth or mutation middleware
  const handlers = route.stack.map(layer => layer.handle)
  const req = { body: { phone }, query: {}, ip: '127.0.0.1', headers: {}, socket: { remoteAddress: '127.0.0.1' }, app: { get: () => false } }
  for (let attempt = 1; attempt <= 11; attempt++) {
    const res = response()
    await invoke(handlers[0], req, res)
    await invoke(handlers[1], req, res)
    if (attempt <= 10) {
      await invoke(handlers[2], req, res)
      assert.equal(res.statusCode, 200); assert.deepEqual(res.body.bookings, [])
    } else assert.equal(res.statusCode, 429)
    assert.equal(res.getHeader('Cache-Control'), 'no-store')
  }
  await assert.rejects(invoke(handlers[2], { body: { phone: 'invalid' }, query: {} }, response()), error => error.name === 'ZodError')
  console.log('Passed lookup normalization, exact legacy equivalence, validation, pagination, DTO privacy, Dhaka date, all statuses/users, missing venues, logged-out handler, empty results, no-store and rate limit checks.')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
