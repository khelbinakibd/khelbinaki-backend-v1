import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { assertOfflineBookingMigration } from '../src/utils/offlineBookingMigration'

const args = ['--offline', '--confirm-database=isolated_development']
const environment = { NODE_ENV: 'development', BOOKING_MIGRATION_OFFLINE_ACK: 'all-writers-stopped-and-access-disabled' }

test('offline acknowledgement and exact database confirmation are both required', () => {
  assert.throws(() => assertOfflineBookingMigration([], {}), /Offline migration required/)
  assert.throws(() => assertOfflineBookingMigration(args, {}), /Offline migration required/)
  assert.throws(() => assertOfflineBookingMigration(args.slice(1), environment), /Offline migration required/)
  assert.throws(() => assertOfflineBookingMigration(['--offline'], environment), /confirm-database/)
  assert.throws(() => assertOfflineBookingMigration(['--offline', '--confirm-database='], environment), /confirm-database/)
  assert.throws(() => assertOfflineBookingMigration([...args, '--confirm-database=other'], environment), /Exactly one/)
  assert.throws(() => assertOfflineBookingMigration(args, environment, 'other'), /differs/)
  assert.doesNotThrow(() => assertOfflineBookingMigration(args, environment, 'isolated_development'))
})

test('production mode is refused even with acknowledgements', () => {
  assert.throws(() => assertOfflineBookingMigration(args, { ...environment, NODE_ENV: 'production' }), /production is refused/)
})

test('unacknowledged legacy CLI refuses before connecting, exits nonzero, and hides connection details', () => {
  const child = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/migrate-bookings-to-facilities.ts'], {
    cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: 'test', MONGODB_URI: 'mongodb://hidden-user:hidden-password@127.0.0.1:1/forbidden', BOOKING_MIGRATION_OFFLINE_ACK: '' },
    encoding: 'utf8',
    timeout: 10000,
  })
  assert.equal(child.error, undefined)
  assert.equal(child.status, 1)
  assert.match(child.stderr, /Offline migration refused/)
  assert.doesNotMatch(child.stdout + child.stderr, /hidden-user|hidden-password|Connected to MongoDB/)
})
