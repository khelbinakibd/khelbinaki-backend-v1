import type { z } from 'zod'
import mongoose from 'mongoose'
import { Facility } from '../models/Facility'
import { MaintenanceBlock } from '../models/MaintenanceBlock'
import { createMaintenanceBlockSchema, listMaintenanceBlocksSchema } from '../schemas/maintenanceSchema'
import AppError from '../utils/AppError'
import { dhakaDateStart, getDhakaDayRange } from '../utils/businessTime'
import { withFacilityOccupancyGuard } from './facilityOccupancyGuard'
import type { OccupancyActor } from './occupancyService'
import { assertSlotUnoccupied, authorizeTurfOccupancy } from './occupancyService'

export function occupancyObjectId(id: string, label: string) {
  if (!/^[a-f\d]{24}$/i.test(id))
    throw new AppError(`Invalid ${label} ID`, 400)
  return new mongoose.Types.ObjectId(id)
}

async function facilityReference(id: string) {
  const facility = await Facility.findById(occupancyObjectId(id, 'facility'))
  if (!facility)
    throw new AppError('Facility not found', 404)
  return facility
}

export async function listMaintenanceBlocks(facilityId: string, actor: OccupancyActor, query: unknown) {
  const input = listMaintenanceBlocksSchema.parse(query)
  const facility = await facilityReference(facilityId)
  await authorizeTurfOccupancy(actor, facility.turf)
  const range = input.date ? getDhakaDayRange(input.date) : undefined
  return MaintenanceBlock.find({
    facility: facility._id, turf: facility.turf,
    ...(input.includeReleased === 'false' ? { releasedAt: null } : {}),
    ...(range ? { date: { $gte: range.start, $lt: range.endExclusive } } : {}),
  }).sort({ date: 1, startTime: 1, _id: 1 }).skip(input.skip).limit(input.limit)
}

export async function createMaintenanceBlock(
  facilityId: string, actor: OccupancyActor, data: z.input<typeof createMaintenanceBlockSchema>,
) {
  const input = createMaintenanceBlockSchema.parse(data)
  const reference = await facilityReference(facilityId)
  const block = await withFacilityOccupancyGuard(occupancyObjectId(facilityId, 'facility'), reference.turf, async (session) => {
    const facility = await Facility.findById(facilityId).session(session)
    if (!facility || !facility.isActive)
      throw new AppError('Facility is not active', 400)
    await authorizeTurfOccupancy(actor, facility.turf, session)
    const slot = { date: dhakaDateStart(input.date), startTime: input.startTime, endTime: input.endTime }
    await assertSlotUnoccupied(occupancyObjectId(facilityId, 'facility'), slot, session)
    const [block] = await MaintenanceBlock.create([{
      ...slot, reason: input.reason, facility: facility._id, turf: facility.turf, createdBy: actor.id,
    }], { session })
    return block
  })
  block.$session(null)
  return block
}

export async function releaseMaintenanceBlock(facilityId: string, blockId: string, actor: OccupancyActor, reason?: string) {
  const reference = await facilityReference(facilityId)
  const id = occupancyObjectId(blockId, 'maintenance block')
  const released = await withFacilityOccupancyGuard(occupancyObjectId(facilityId, 'facility'), reference.turf, async (session) => {
    await authorizeTurfOccupancy(actor, reference.turf, session)
    const block = await MaintenanceBlock.findOne({ _id: id, facility: reference._id, turf: reference.turf }).session(session)
    if (!block)
      throw new AppError('Maintenance block not found', 404)
    // Idempotent release preserves the original audit actor, time and reason.
    if (block.releasedAt)
      return block
    block.releasedAt = new Date()
    block.releasedBy = occupancyObjectId(actor.id, 'user')
    block.releaseReason = reason
    await block.save({ session })
    return block
  })
  released.$session(null)
  return released
}
