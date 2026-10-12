import mongoose from 'mongoose'

export interface IMaintenanceBlock extends mongoose.Document {
  facility: mongoose.Types.ObjectId
  turf: mongoose.Types.ObjectId
  date: Date
  startTime: string
  endTime: string
  reason?: string
  createdBy: mongoose.Types.ObjectId
  releasedAt?: Date
  releasedBy?: mongoose.Types.ObjectId
  releaseReason?: string
}

const schema = new mongoose.Schema<IMaintenanceBlock>({
  facility: { type: mongoose.Schema.Types.ObjectId, ref: 'Facility', required: true, immutable: true },
  turf: { type: mongoose.Schema.Types.ObjectId, ref: 'Turf', required: true, immutable: true },
  date: { type: Date, required: true, immutable: true },
  startTime: { type: String, required: true, immutable: true },
  endTime: { type: String, required: true, immutable: true },
  reason: { type: String, maxlength: 500, immutable: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  releasedAt: { type: Date },
  releasedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  releaseReason: { type: String, maxlength: 500 },
}, { timestamps: true })

schema.index({ facility: 1, date: 1, releasedAt: 1 })
export const MaintenanceBlock = mongoose.model<IMaintenanceBlock>('MaintenanceBlock', schema)
