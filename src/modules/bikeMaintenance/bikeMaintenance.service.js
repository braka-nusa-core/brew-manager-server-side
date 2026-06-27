// ============================================================
// modules/bikeMaintenance/bikeMaintenance.service.js
// All business logic for BikeDamageReport and BikeRepairRecord.
//
// Note: the GET /api/v1/bikes/maintenance dashboard endpoint lives
// in bike.service.js (getMaintenanceDashboard), NOT here — per
// approved spec, that endpoint is mounted inside the Bike module's
// own routes (/api/v1/bikes/maintenance), even though it reads
// BikeDamageReport data. This file covers only the CRUD endpoints
// under /bike-damage-reports and /bike-repair-records.
// ============================================================

import mongoose          from 'mongoose'
import BikeDamageReport   from '../../models/BikeDamageReport.model.js'
import BikeRepairRecord   from '../../models/BikeRepairRecord.model.js'
import Bike                from '../../models/Bike.model.js'
import ApiError            from '../../utils/ApiError.js'
import { buildPaginationQuery, buildPaginationMeta } from '../../utils/pagination.js'

// ── Damage Report ──────────────────────────────────────────────

export const createDamageReport = async (tenantId, userId, data) => {
  const tenantOid = new mongoose.Types.ObjectId(tenantId)
  const bikeOid   = new mongoose.Types.ObjectId(data.bikeId)

  const bike = await Bike.findOne({ _id: bikeOid, tenantId: tenantOid }).lean()
  if (!bike) throw new ApiError(404, 'Bike not found')

  const report = await BikeDamageReport.create({
    tenantId:   tenantOid,
    bikeId:     bikeOid,
    reportedBy: new mongoose.Types.ObjectId(userId),
    damageType: data.damageType,
    severity:   data.severity,
    notes:      data.notes?.trim() ?? null,
    // status omitted — schema default OPEN applies
  })

  return report.toObject()
}

export const getDamageReports = async (tenantId, queryParams) => {
  const { page, limit, skip } = buildPaginationQuery(queryParams)

  const filter = { tenantId: new mongoose.Types.ObjectId(tenantId) }

  if (queryParams.bikeId) filter.bikeId = new mongoose.Types.ObjectId(queryParams.bikeId)
  if (queryParams.status) filter.status = queryParams.status

  const [reports, total] = await Promise.all([
    BikeDamageReport.find(filter)
      .sort({ reportedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    BikeDamageReport.countDocuments(filter),
  ])

  return { reports, pagination: buildPaginationMeta({ total, page, limit }) }
}

export const updateDamageReportStatus = async (tenantId, damageReportId, status) => {
  const report = await BikeDamageReport.findOneAndUpdate(
    {
      _id:      new mongoose.Types.ObjectId(damageReportId),
      tenantId: new mongoose.Types.ObjectId(tenantId),
    },
    { $set: { status } },
    { new: true, runValidators: true }
  ).lean()

  if (!report) throw new ApiError(404, 'Damage report not found')

  return report
}

// ── Repair Record ───────────────────────────────────────────────

export const createRepairRecord = async (tenantId, data) => {
  const tenantOid = new mongoose.Types.ObjectId(tenantId)
  const reportOid = new mongoose.Types.ObjectId(data.damageReportId)

  const report = await BikeDamageReport.findOne({ _id: reportOid, tenantId: tenantOid }).lean()
  if (!report) throw new ApiError(404, 'Damage report not found')

  const record = await BikeRepairRecord.create({
    tenantId:       tenantOid,
    damageReportId: reportOid,
    repairDate:     new Date(data.repairDate),
    cost:           data.cost,
    notes:          data.notes?.trim() ?? null,
    // repairStatus omitted — schema default IN_PROGRESS applies
  })

  return record.toObject()
}

export const getRepairRecords = async (tenantId, queryParams) => {
  const { page, limit, skip } = buildPaginationQuery(queryParams)

  const filter = { tenantId: new mongoose.Types.ObjectId(tenantId) }

  if (queryParams.damageReportId) {
    filter.damageReportId = new mongoose.Types.ObjectId(queryParams.damageReportId)
  }
  if (queryParams.repairStatus) filter.repairStatus = queryParams.repairStatus

  const [records, total] = await Promise.all([
    BikeRepairRecord.find(filter)
      .sort({ repairDate: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    BikeRepairRecord.countDocuments(filter),
  ])

  return { records, pagination: buildPaginationMeta({ total, page, limit }) }
}

export const updateRepairRecord = async (tenantId, repairRecordId, data) => {
  const updateData = {}
  if (data.repairStatus !== undefined) updateData.repairStatus = data.repairStatus
  if (data.cost         !== undefined) updateData.cost         = data.cost
  if (data.notes        !== undefined) updateData.notes        = data.notes?.trim() ?? null

  const record = await BikeRepairRecord.findOneAndUpdate(
    {
      _id:      new mongoose.Types.ObjectId(repairRecordId),
      tenantId: new mongoose.Types.ObjectId(tenantId),
    },
    { $set: updateData },
    { new: true, runValidators: true }
  ).lean()

  if (!record) throw new ApiError(404, 'Repair record not found')

  return record
}