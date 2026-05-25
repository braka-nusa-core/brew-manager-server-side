# BrewManager Backend

**Multi-Tenant Coffee Shop Management System API**

Production-grade REST API built with Node.js, Express, and MongoDB.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 18+ (ES Modules) |
| Framework | Express.js 4 |
| Database | MongoDB + Mongoose 8 |
| Auth | JWT (access + refresh token rotation) |
| Security | Helmet, CORS, express-rate-limit, express-mongo-sanitize, xss-clean |
| Logging | Morgan + custom structured logger |

---

## Prerequisites

- Node.js >= 18.0.0
- MongoDB >= 6.0 (local or Atlas)
- npm >= 9

---

## Setup Instructions

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Open `.env` and fill in all values. See the **Environment Variables** section below.

### 3. Start the server

**Development** (auto-restarts on file changes via `--watch`):
```bash
npm run dev
```

**Production:**
```bash
npm start
```

The server will:
1. Validate all required environment variables (crashes immediately if any are missing)
2. Connect to MongoDB
3. Start listening on the configured PORT

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `NODE_ENV` | No | `development` | `development` or `production` |
| `PORT` | No | `5000` | HTTP port to listen on |
| `MONGO_URI` | **Yes** | — | MongoDB connection string |
| `JWT_ACCESS_SECRET` | **Yes** | — | Secret for signing access tokens (min 32 chars) |
| `JWT_REFRESH_SECRET` | **Yes** | — | Secret for signing refresh tokens (min 32 chars, different from access) |
| `JWT_ACCESS_EXPIRES` | No | `15m` | Access token TTL (e.g. `15m`, `1h`) |
| `JWT_REFRESH_EXPIRES` | No | `7d` | Refresh token TTL (e.g. `7d`, `30d`) |
| `CORS_ORIGINS` | No | `localhost:5173,localhost:3000` | Comma-separated allowed frontend origins |

**Generate secure secrets:**
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```
Run this twice — use one value for `JWT_ACCESS_SECRET`, a different one for `JWT_REFRESH_SECRET`.

---

## API Base URL

```
http://localhost:5000/api/v1
```

### Health Check
```
GET http://localhost:5000/health
```

---

## API Endpoints

### Authentication
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/auth/login` | No | Login with email + password |
| POST | `/auth/logout` | No | Clear refresh token cookie |
| POST | `/auth/refresh-token` | Cookie | Rotate tokens |
| GET | `/auth/me` | Bearer | Get current user profile |

### Employees
| Method | Endpoint | Permission | Description |
|---|---|---|---|
| POST | `/employees` | MANAGE_EMPLOYEES | Create employee |
| GET | `/employees` | VIEW_EMPLOYEES | List employees |
| GET | `/employees/:id` | VIEW_EMPLOYEES | Get employee |
| PATCH | `/employees/:id` | MANAGE_EMPLOYEES | Update employee |
| PATCH | `/employees/:id/toggle-active` | MANAGE_EMPLOYEES | Toggle active status |
| DELETE | `/employees/:id` | MANAGE_EMPLOYEES | Soft delete |

### Attendance
| Method | Endpoint | Permission | Description |
|---|---|---|---|
| POST | `/attendance` | RECORD_ATTENDANCE | Create single record |
| POST | `/attendance/bulk` | RECORD_ATTENDANCE | Bulk create for one date |
| GET | `/attendance` | VIEW_ATTENDANCE | List records |
| GET | `/attendance/:id` | VIEW_ATTENDANCE | Get single record |
| PATCH | `/attendance/:id` | RECORD_ATTENDANCE | Update status/notes |
| DELETE | `/attendance/:id` | RECORD_ATTENDANCE | Hard delete (correction) |

### Sales
| Method | Endpoint | Permission | Description |
|---|---|---|---|
| POST | `/sales` | MANAGE_SALES | Create sale record |
| GET | `/sales` | VIEW_SALES | List sales |
| GET | `/sales/summary/employee` | VIEW_SALES | Employee sales aggregation |
| GET | `/sales/summary/outlet` | VIEW_SALES | Outlet sales aggregation |
| GET | `/sales/:id` | VIEW_SALES | Get single sale |
| PATCH | `/sales/:id` | MANAGE_SALES | Update sale |
| DELETE | `/sales/:id` | MANAGE_SALES | Delete sale |

### Expenses
| Method | Endpoint | Permission | Description |
|---|---|---|---|
| POST | `/expenses` | MANAGE_EXPENSES | Create expense |
| GET | `/expenses` | VIEW_EXPENSES | List expenses |
| GET | `/expenses/:id` | VIEW_EXPENSES | Get single expense |
| PATCH | `/expenses/:id` | MANAGE_EXPENSES | Update expense |
| DELETE | `/expenses/:id` | MANAGE_EXPENSES | Delete expense |

### Payroll
| Method | Endpoint | Permission | Description |
|---|---|---|---|
| POST | `/payroll/generate` | MANAGE_PAYROLL | Generate payroll for outlet+period |
| GET | `/payroll` | VIEW_PAYROLL | List payrolls |
| GET | `/payroll/:id` | VIEW_PAYROLL | Get single payroll |
| PATCH | `/payroll/:id/adjust` | MANAGE_PAYROLL | Adjust bonus/deductions |
| PATCH | `/payroll/:id/approve` | MANAGE_PAYROLL | Approve draft |
| PATCH | `/payroll/:id/reject` | MANAGE_PAYROLL | Revert to draft |
| PATCH | `/payroll/:id/paid` | MANAGE_PAYROLL | Mark as paid |

### Dashboard Analytics
| Method | Endpoint | Permission | Description |
|---|---|---|---|
| GET | `/dashboard/summary` | VIEW_DASHBOARD | KPI summary |
| GET | `/dashboard/sales-trend` | VIEW_DASHBOARD | Daily sales trend |
| GET | `/dashboard/expense-trend` | VIEW_DASHBOARD | Daily expense trend |
| GET | `/dashboard/attendance-summary` | VIEW_DASHBOARD | Attendance breakdown |
| GET | `/dashboard/employee-performance` | VIEW_DASHBOARD | Employee performance |

---

## Role System

| Role | Description |
|---|---|
| `super_admin` | Platform-level — bypasses all tenant/outlet restrictions |
| `tenant_admin` | Full access within their tenant, all outlets |
| `manager` | Manages their own outlet only |
| `cashier` | Limited — sales input only, no attendance/expense/payroll access |

---

## Multi-Tenant Architecture

- Every data document includes `tenantId`
- `tenantId` is always derived from the JWT — never from the request body
- Outlet-scoped roles (`manager`, `cashier`) are further restricted by `outletId` from the JWT
- All MongoDB queries include `tenantId` as the first filter to leverage compound indexes

---

## Project Structure

```
backend/
├── server.js                    # Entry point
├── package.json
├── .env.example
└── src/
    ├── app.js                   # Express + middleware setup
    ├── config/
    │   ├── env.js               # Centralized env + startup validation
    │   ├── db.js                # MongoDB connection
    │   └── payroll.config.js    # Payroll constants
    ├── constants/
    │   └── permissions.js       # ROLES, PERMISSIONS, ROLE_PERMISSIONS
    ├── middlewares/
    │   ├── authenticate.js      # JWT verification
    │   ├── authorize.js         # Permission-based route guard
    │   ├── tenantGuard.js       # Tenant/outlet isolation
    │   ├── rateLimiter.js       # Auth + general rate limits
    │   ├── sanitize.js          # NoSQL injection + XSS
    │   ├── validateObjectId.js  # Route param validation
    │   ├── error.middleware.js  # Global error handler
    │   └── notFound.middleware.js
    ├── models/
    │   ├── User.model.js
    │   ├── Employee.model.js
    │   ├── Attendance.model.js
    │   ├── Sale.model.js
    │   ├── Expense.model.js
    │   └── Payroll.model.js
    ├── modules/
    │   ├── auth/
    │   ├── employee/
    │   ├── attendance/
    │   ├── sales/
    │   ├── expense/
    │   ├── payroll/
    │   └── dashboard/
    └── utils/
        ├── ApiError.js
        ├── apiResponse.js
        ├── asyncHandler.js
        ├── generateToken.js
        ├── hashPassword.js
        ├── comparePassword.js
        ├── pagination.js
        └── logger.js
```

---

## Payroll Calculation

```
Monthly:  salaryEarned = floor((baseSalary / workingDays) × presentDays)
Daily:    salaryEarned = floor(baseSalary × presentDays)
Bonus:    cupsBonus    = floor(totalCupsSold × BONUS_PER_CUP)  [default: 500/cup]
Total:    totalPay     = max(0, salaryEarned + cupsBonus + manualBonus - deductions)
```

Attendance statuses counted as present: `present`, `late`

---

## Security Features

- JWT access tokens (15 min TTL) stored in memory on frontend
- Refresh tokens in `httpOnly` cookies (7 day TTL), path-restricted to `/api/v1/auth`
- Helmet security headers on all responses
- Rate limiting: 20 req/15min on auth, 500 req/15min on API
- MongoDB operator injection prevention (express-mongo-sanitize)
- XSS sanitization (xss-clean)
- No stack traces exposed in production
- `tenantId` never accepted from client — always from verified JWT

---

## Checkpoint

This is the **Step 10 checkpoint** of the BrewManager backend implementation.
All backend modules (auth, employee, attendance, sales, expense, payroll, dashboard) are complete and production-hardened.
