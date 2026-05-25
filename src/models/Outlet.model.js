import mongoose from 'mongoose'

const { Schema, model } = mongoose

const outletSchema = new Schema(
  {
    tenantId: {
      type:     Schema.Types.ObjectId,
      ref:      'Tenant',
      required: [true, 'Tenant ID is required'],
    },
    name: {
      type: String, required: [true, 'Outlet name is required'],
      trim: true, minlength: [2, 'Name must be at least 2 characters'], maxlength: [100, 'Name too long'],
    },
    code: {
      type: String, required: [true, 'Outlet code is required'],
      trim: true, uppercase: true,
      minlength: [2, 'Code must be at least 2 characters'], maxlength: [10, 'Code must not exceed 10 characters'],
    },
    address:   { type: String, trim: true, default: null },
    phone:     { type: String, trim: true, default: null },
    isActive:  { type: Boolean, default: true },
    deletedAt: { type: Date,    default: null },
  },
  { timestamps: true, versionKey: false }
)

outletSchema.index({ tenantId: 1, isActive: 1 })
outletSchema.index({ tenantId: 1, code: 1 }, { unique: true })
outletSchema.index({ tenantId: 1, name: 1 })

const Outlet = model('Outlet', outletSchema)
export default Outlet