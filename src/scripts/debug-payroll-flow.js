// ============================================================
// scripts/debug-payroll-flow.js
//
// TEMPORARY, READ-ONLY INTEGRATION DEBUG SCRIPT.
//
// Tujuan:
//   Men-trace flow Employee → Attendance → Sale → Payroll persis
//   seperti generatePayroll() di payroll.service.js, step demi
//   step, supaya kelihatan tepat di step mana data putus/hilang.
//
// TIDAK melakukan:
//   - insertMany()
//   - updateOne() / bulkWrite() / save()
//   - deleteOne() / deleteMany()
//   - TIDAK mengubah payroll.service.js
//   - TIDAK menduplikasi schema — semua model diimpor langsung
//     dari src/models/*.js
//
// Catatan soal getPeriodDateRange():
//   Fungsi itu adalah `const` lokal (tidak di-export) di dalam
//   payroll.service.js baris ~66. Karena tidak diekspor, script
//   ini tidak bisa meng-import-nya langsung tanpa mengubah file
//   tersebut (dan kita diminta TIDAK menyentuh payroll.service).
//   Jadi logikanya disalin verbatim di bawah — identik byte-demi-
//   byte dengan sumber aslinya. Jika suatu saat payroll.service.js
//   diubah, salinan ini WAJIB disamakan lagi secara manual.
//
// Usage:
//   MONGO_URI="mongodb://..." node scripts/debug-payroll-flow.js \
//     --tenantId=<tenantId> --outletId=<outletId> --month=<1-12> --year=<yyyy> \
//     [--workingDays=<n>]
// ============================================================

import 'dotenv/config'
import mongoose from 'mongoose'

import Outlet     from '../models/Outlet.model.js'
import Employee   from '../models/Employee.model.js'
import Attendance from '../models/Attendance.model.js'
import Sale       from '../models/Sale.model.js'
import Payroll    from '../models/Payroll.model.js'

// ── CLI args ────────────────────────────────────────────────

const parseArgs = () => {
  const args = {}
  for (const arg of process.argv.slice(2)) {
    const match = arg.match(/^--([^=]+)=(.*)$/)
    if (match) args[match[1]] = match[2]
  }
  return args
}

const { tenantId, outletId, month, year, workingDays } = parseArgs()

const usageAndExit = (msg) => {
  console.error(`\n[ERROR] ${msg}\n`)
  console.error(
    'Usage:\n' +
    '  node scripts/debug-payroll-flow.js --tenantId=<id> --outletId=<id> --month=<1-12> --year=<yyyy> [--workingDays=<n>]\n'
  )
  process.exit(1)
}

if (!tenantId) usageAndExit('--tenantId wajib diisi')
if (!outletId) usageAndExit('--outletId wajib diisi')
if (!month)    usageAndExit('--month wajib diisi')
if (!year)     usageAndExit('--year wajib diisi')

if (!mongoose.Types.ObjectId.isValid(tenantId)) usageAndExit('--tenantId bukan ObjectId yang valid')
if (!mongoose.Types.ObjectId.isValid(outletId)) usageAndExit('--outletId bukan ObjectId yang valid')

const numMonth = Number(month)
const numYear  = Number(year)
const numWorkingDays = workingDays ? Number(workingDays) : 26 // hanya untuk konteks tampilan, tidak memengaruhi query

if (!Number.isInteger(numMonth) || numMonth < 1 || numMonth > 12) {
  usageAndExit('--month harus integer 1-12')
}
if (!Number.isInteger(numYear) || numYear < 2000) {
  usageAndExit('--year harus integer >= 2000')
}

const tenantOid = new mongoose.Types.ObjectId(tenantId)
const outletOid = new mongoose.Types.ObjectId(outletId)

// ── getPeriodDateRange() — SALINAN VERBATIM dari payroll.service.js baris ~66 ──

const getPeriodDateRange = (m, y) => {
  const start = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0, 0))
  const end   = new Date(Date.UTC(y, m, 0, 23, 59, 59, 999))
  return { start, end }
}

const { start, end } = getPeriodDateRange(numMonth, numYear)

// ── buildDailySalesMap() — SALINAN dari payroll.service.js, hanya untuk totalCups/totalRevenue ──

const buildTotalsFromSalesAgg = (salesAggResult) => {
  let totalCups = 0
  let totalRevenue = 0
  for (const row of salesAggResult) {
    totalCups += row.dailyCups ?? 0
    totalRevenue += row.dailyRevenue ?? 0
  }
  return { totalCups, totalRevenue }
}

const line = (char = '=') => console.log(char.repeat(60))

// ── MAIN ────────────────────────────────────────────────────

const run = async () => {
  await mongoose.connect(process.env.MONGO_URI)

  line('=')
  console.log('PAYROLL FLOW DEBUG (READ-ONLY)')
  line('=')
  console.log(`tenantId : ${tenantId}`)
  console.log(`outletId : ${outletId}`)
  console.log(`period   : ${numMonth}/${numYear}`)
  console.log(`range    : ${start.toISOString()} → ${end.toISOString()}`)
  console.log('')

  // ── STEP 1: Outlet ──────────────────────────────────────────

  line('-')
  console.log('STEP 1 — Outlet')
  line('-')

  const outlet = await Outlet.findOne({
    _id:       outletOid,
    isActive:  true,
    deletedAt: null,
    tenantId:  tenantOid,
  }).lean()

  if (!outlet) {
    console.log('[BROKEN HERE] Outlet.findOne(...) => NOT FOUND')
    console.log('generatePayroll() akan throw 404 di titik ini. Flow berhenti total.')
    await mongoose.disconnect()
    return
  }

  console.log(`outletId:             ${outlet._id}`)
  console.log(`payrollType:          ${outlet.payrollType}`)
  console.log(`commissionPercentage: ${outlet.commissionPercentage}`)
  console.log(`bonusRules:           ${JSON.stringify(outlet.bonusRules ?? [])}`)
  console.log('')

  // ── STEP 2: Employee — query IDENTIK generatePayroll() ───────

  line('-')
  console.log('STEP 2 — Employee (query identik dengan generatePayroll())')
  line('-')

  const employeeQuery = { outletId: outletOid, isActive: true, tenantId: tenantOid }
  console.log(`Query: Employee.find(${JSON.stringify({ outletId, isActive: true, tenantId })})`)
  console.log('')

  const employees = await Employee.find(employeeQuery).lean()

  console.log(`Jumlah employee ditemukan: ${employees.length}`)
  console.log('')

  if (employees.length === 0) {
    console.log('[BROKEN HERE] Employee.find(...) => 0 hasil')
    console.log('generatePayroll() akan return early: { generated: 0, updated: 0, skipped: 0 }')
    console.log('Flow berhenti di sini — Attendance, Sale, dan Payroll TIDAK PERNAH di-query.')
    await mongoose.disconnect()
    return
  }

  for (const emp of employees) {
    console.log(`employeeId: ${emp._id}`)
    console.log(`name:       ${emp.name}`)
    console.log(`outletId:   ${emp.outletId}`)
    console.log(`tenantId:   ${emp.tenantId}`)
    console.log(`isActive:   ${emp.isActive}`)
    console.log('---')
  }
  console.log('')

  // ── STEP 3–5: per employee — Attendance, Sale, Payroll ───────

  const results = []

  for (const emp of employees) {
    const empLabel = `${emp.name} (${emp._id})`

    line('-')
    console.log(`Employee: ${empLabel}`)
    line('-')

    // STEP 3 — Attendance (query identik generatePayroll())
    console.log('STEP 3 — Attendance')

    const attendanceRecords = await Attendance.find({
      tenantId:   tenantOid,
      employeeId: emp._id,
      date:       { $gte: start, $lte: end },
    }).lean()

    let presentDays = 0
    let absentDays  = 0
    for (const record of attendanceRecords) {
      if (record.status === 'present' || record.status === 'late') presentDays++
      else absentDays++
    }

    console.log(`  total attendance : ${attendanceRecords.length}`)
    console.log(`  present          : ${presentDays}`)
    console.log(`  absent           : ${absentDays}`)

    if (attendanceRecords.length === 0) {
      console.log('  [BROKEN HERE candidate] Tidak ada dokumen Attendance pada periode ini.')
    }
    console.log('')

    // STEP 4 — Sale (query & aggregate identik generatePayroll())
    console.log('STEP 4 — Sale')

    const saleQuery = {
      tenantId:   tenantOid,
      employeeId: emp._id,
      date:       { $gte: start, $lte: end },
    }

    const saleDocs = await Sale.find(saleQuery).lean()

    const salesAggResult = await Sale.aggregate([
      { $match: saleQuery },
      {
        $group: {
          _id:          { date: '$date' },
          dailyCups:    { $sum: '$totalCups' },
          dailyRevenue: { $sum: '$totalRevenue' },
        },
      },
      { $sort: { '_id.date': 1 } },
    ])

    const { totalCups, totalRevenue } = buildTotalsFromSalesAgg(salesAggResult)

    console.log(`  sale count    : ${saleDocs.length}`)
    console.log(`  total cups    : ${totalCups}`)
    console.log(`  total revenue : ${totalRevenue}`)

    if (saleDocs.length === 0) {
      console.log('  [BROKEN HERE candidate] Tidak ada dokumen Sale pada periode ini untuk employee ini.')
    } else {
      console.log('')
      console.log('  Detail Sale:')
      for (const s of saleDocs) {
        console.log(`    _id: ${s._id} | employeeId: ${s.employeeId} | outletId: ${s.outletId} | totalCups: ${s.totalCups} | totalRevenue: ${s.totalRevenue} | date: ${new Date(s.date).toISOString()}`)
      }
    }
    console.log('')

    // STEP 5 — Existing Payroll (query identik generatePayroll())
    console.log('STEP 5 — Payroll existing')

    const existing = await Payroll.findOne({
      employeeId:     emp._id,
      'period.month': numMonth,
      'period.year':  numYear,
      tenantId:       tenantOid,
    }).lean()

    if (existing) {
      console.log(`  found  : YES`)
      console.log(`  id     : ${existing._id}`)
      console.log(`  status : ${existing.status}`)
    } else {
      console.log('  found  : NOT FOUND')
    }
    console.log('')

    results.push({
      emp,
      attendanceCount: attendanceRecords.length,
      saleCount: saleDocs.length,
      existing,
    })
  }

  // ── STEP 6: Kesimpulan akhir per employee ────────────────────

  line('=')
  console.log('STEP 6 — KEPUTUSAN AKHIR')
  line('=')

  for (const r of results) {
    const { emp, attendanceCount, saleCount, existing } = r

    console.log(`Employee ${emp.name}`)
    console.log(`Attendance : ${attendanceCount > 0 ? 'OK' : 'EMPTY'}`)
    console.log(`Sales      : ${saleCount > 0 ? 'OK' : 'EMPTY'}`)
    console.log(`Payroll    : ${existing ? existing.status.toUpperCase() : 'NOT FOUND'}`)

    let decision
    if (existing && existing.status !== 'draft') {
      decision = 'SHOULD SKIP (payroll sudah terkunci — approved/paid)'
    } else if (existing && existing.status === 'draft') {
      decision = 'SHOULD UPDATE (draft existing akan dihitung ulang)'
    } else if (saleCount === 0) {
      decision = 'SHOULD CREATE WITH ZERO SALES (belum ada payroll, sale kosong)'
    } else {
      decision = 'SHOULD CREATE'
    }

    console.log(`=> ${decision}`)
    console.log('')
  }

  await mongoose.disconnect()
}

run().catch(async (err) => {
  console.error('\n[SCRIPT ERROR]', err)
  await mongoose.disconnect().catch(() => {})
  process.exit(1)
})