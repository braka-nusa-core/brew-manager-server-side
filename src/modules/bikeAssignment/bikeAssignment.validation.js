// ============================================================
// modules/bikeAssignment/bikeAssignment.validation.js
// Pure validation. DB-dependent checks (rider status, bike
// status, existing active assignment) live in the service layer.
// ============================================================

const OBJECT_ID_RE = /^[a-f\d]{24}$/i
const isValidObjectId = (id) => typeof id === 'string' && OBJECT_ID_RE.test(id)
const isValidDate = (v) => typeof v === 'string' && !isNaN(Date.parse(v))

// ── validateCreateAssignment ───────────────────────────────────

export const validateCreateAssignment = (body) => {
  const errors = []
  const { bikeId, employeeId, startDate } = body

  if (!bikeId) {
    errors.push('bikeId is required')
  } else if (!isValidObjectId(bikeId)) {
    errors.push('bikeId must be a valid ObjectId')
  }

  if (!employeeId) {
    errors.push('employeeId is required')
  } else if (!isValidObjectId(employeeId)) {
    errors.push('employeeId must be a valid ObjectId')
  }

  if (!startDate) {
    errors.push('startDate is required')
  } else if (!isValidDate(startDate)) {
    errors.push('startDate must be a valid date string')
  }

  return { isValid: errors.length === 0, errors }
}