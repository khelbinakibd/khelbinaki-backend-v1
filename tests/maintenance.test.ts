import assert from 'node:assert/strict'
import { test } from 'node:test'
import mongoose from 'mongoose'
import { createMaintenanceBlockSchema } from '../src/schemas/maintenanceSchema'
import { assertTurfAssignment, occupancyInterval, slotsOverlap } from '../src/services/occupancyService'
import { dhakaDateStart } from '../src/utils/businessTime'

const date = dhakaDateStart('2099-06-01')
const slot = (startTime: string, endTime: string, day = date) => ({ date: day, startTime, endTime })

test('maintenance rejects invalid dates, malformed times, equal times and overnight intervals', () => {
  for (const data of [
    { date: '2099-02-30', startTime: '10:00', endTime: '11:00' },
    { date: '2099-06-01', startTime: '24:00', endTime: '11:00' },
    { date: '2099-06-01', startTime: '10:00', endTime: '10:00' },
    { date: '2099-06-01', startTime: '23:00', endTime: '01:00' },
  ]) {
    assert.equal(createMaintenanceBlockSchema.safeParse(data).success, false)
  }
  assert.equal(createMaintenanceBlockSchema.safeParse({ date: '2099-06-01', startTime: '10:00', endTime: '11:00' }).success, true)
})

test('half-open intervals reject overlap and allow adjacency in Asia/Dhaka', () => {
  assert.equal(slotsOverlap(slot('10:00', '11:00'), slot('11:00', '12:00')), false)
  assert.equal(slotsOverlap(slot('10:00', '11:00'), slot('10:30', '11:30')), true)
  assert.equal(slotsOverlap(slot('10:00', '12:00'), slot('10:30', '11:00')), true)
  assert.equal(occupancyInterval(slot('10:00', '11:00')).start, Date.parse('2099-06-01T04:00:00Z'))
  assert.equal(slotsOverlap(slot('23:00', '01:00'), slot('00:30', '01:30', dhakaDateStart('2099-06-02'))), true)
  assert.equal(slotsOverlap(slot('23:00', '01:00'), slot('01:00', '02:00', dhakaDateStart('2099-06-02'))), false)
})

test('managers are platform-wide; an admin role alone does not grant turf access', () => {
  const assigned = new mongoose.Types.ObjectId()
  const other = new mongoose.Types.ObjectId().toString()
  assert.doesNotThrow(() => assertTurfAssignment({ id: other, role: 'manager' }, []))
  assert.doesNotThrow(() => assertTurfAssignment({ id: assigned.toString(), role: 'admin' }, [assigned]))
  assert.doesNotThrow(() => assertTurfAssignment({ id: assigned.toString(), role: 'user' }, [assigned]))
  assert.throws(() => assertTurfAssignment({ id: other, role: 'admin' }, [assigned]), /Forbidden/)
  assert.throws(() => assertTurfAssignment({ id: other, role: 'user' }, [assigned]), /Forbidden/)
})
