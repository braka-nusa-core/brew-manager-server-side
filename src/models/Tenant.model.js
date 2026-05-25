import mongoose from 'mongoose'

const { Schema, model } = mongoose

export const TENANT_PLANS = ['starter', 'professional', 'enterprise']

const tenantSchema = new Schema(
  {
    name: {
      type:      String,
      required:  [true, 'Tenant name is required'],
      trim:      true,
      minlength: [2,   'Name must be at least 2 characters'],
      maxlength: [100, 'Name must not exceed 100 characters'],
    },

    slug: {
      type:      String,
      required:  [true, 'Slug is required'],
      trim:      true,
      lowercase: true,
      match:     [/^[a-z0-9-]+$/, 'Slug may only contain lowercase letters, numbers, and hyphens'],
      minlength: [2,  'Slug must be at least 2 characters'],
      maxlength: [60, 'Slug must not exceed 60 characters'],
    },

    plan: {
      type:    String,
      enum:    { values: TENANT_PLANS, message: `Plan must be one of: ${TENANT_PLANS.join(', ')}` },
      default: 'starter',
    },

    isActive:  { type: Boolean, default: true },
    deletedAt: { type: Date,    default: null  },

    createdBy: {
      type:    Schema.Types.ObjectId,
      ref:     'User',
      default: null,
    },
  },
  { timestamps: true, versionKey: false }
)

tenantSchema.index({ slug: 1 }, { unique: true })
tenantSchema.index({ isActive: 1 })
tenantSchema.index({ plan: 1, isActive: 1 })

const Tenant = model('Tenant', tenantSchema)
export default Tenant