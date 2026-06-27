// ============================================================
// modules/bikeMaintenance/bikeMaintenance.validation.js
// Pure validation for both BikeDamageReport and BikeRepairRecord.
// Kept in one file since both belong to the same module folder
// per approved architecture (Question C: separate collections,
// same module).
// ============================================================

import {
  DAMAGE_TYPES,
  DAMAGE_SEVERITIES,
  DAMAGE_REPORT_STATUSES,
} from '../../models/BikeDamageReport.model.js'
import { REPAIR_STATUSES } from '../../models/BikeRepairRecord.model.js'

const OBJECT_ID_RE = /^[a-f\d]{24}$/i
const isValidObjectId = (id) => typeof id === 'string' && OBJECT_ID_RE.test(id)
const isValidDate = (v) => typeof v === 'string' && !isNaN(Date.parse(v))

// ── Damage Report ──────────────────────────────────────────────

export const validateCreateDamageReport = (body) => {
  const errors = []
  const { bikeId, damageType, severity } = body

  if (!bikeId) {
    errors.push('bikeId is required')
  } else if (!isValidObjectId(bikeId)) {
    errors.push('bikeId must be a valid ObjectId')
  }

  if (!damageType) {
    errors.push('damageType is required')
  } else if (!DAMAGE_TYPES.includes(damageType)) {
    errors.push(`damageType must be one of: ${DAMAGE_TYPES.join(', ')}`)
  }

  if (!severity) {
    errors.push('severity is required')
  } else if (!DAMAGE_SEVERITIES.includes(severity)) {
    errors.push(`severity must be one of: ${DAMAGE_SEVERITIES.join(', ')}`)
  }

  return { isValid: errors.length === 0, errors }
}

export const validateDamageReportStatus = (body) => {
  const errors = []
  const { status } = body

  if (!status) {
    errors.push('status is required')
  } else if (!DAMAGE_REPORT_STATUSES.includes(status)) {
    errors.push(`status must be one of: ${DAMAGE_REPORT_STATUSES.join(', ')}`)
  }

  return { isValid: errors.length === 0, errors }
}

// ── Repair Record ───────────────────────────────────────────────

export const validateCreateRepairRecord = (body) => {
  const errors = []
  const { damageReportId, repairDate, cost } = body

  if (!damageReportId) {
    errors.push('damageReportId is required')
  } else if (!isValidObjectId(damageReportId)) {
    errors.push('damageReportId must be a valid ObjectId')
  }

  if (!repairDate) {
    errors.push('repairDate is required')
  } else if (!isValidDate(repairDate)) {
    errors.push('repairDate must be a valid date string')
  }

  if (cost === undefined || cost === null) {
    errors.push('cost is required')
  } else if (typeof cost !== 'number' || isNaN(cost)) {
    errors.push('cost must be a number')
  } else if (cost < 0) {
    errors.push('cost cannot be negative')
  }

  return { isValid: errors.length === 0, errors }
}

export const validateUpdateRepairRecord = (body) => {
  const errors = []
  const { repairStatus, cost, notes } = body

  if (repairStatus === undefined && cost === undefined && notes === undefined) {
    errors.push('At least one of repairStatus, cost, or notes must be provided')
  }

  if (repairStatus !== undefined && !REPAIR_STATUSES.includes(repairStatus)) {
    errors.push(`repairStatus must be one of: ${REPAIR_STATUSES.join(', ')}`)
  }

  if (cost !== undefined) {
    if (typeof cost !== 'number' || isNaN(cost)) {
      errors.push('cost must be a number')
    } else if (cost < 0) {
      errors.push('cost cannot be negative')
    }
  }

  if (notes !== undefined && notes !== null && typeof notes !== 'string') {
    errors.push('notes must be a string')
  }

  return { isValid: errors.length === 0, errors }
}