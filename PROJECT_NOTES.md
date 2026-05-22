# Roll Production System - Project Notes

Last updated: 2026-05-20

## Current Status

This project is a React/Vite prototype for **Roll Production System** with DB-only runtime through a REST API.

Runtime flow:

```text
React Frontend -> Express REST API -> PostgreSQL DBWilliam.rps
```

The frontend no longer uses dummy/localStorage data for runtime master data, transactions, reports, correction, or void.
`localStorage` is only used to persist `currentUserId` for session convenience.

## Tech Stack

- Frontend: Vite + React + TypeScript
- Styling: plain CSS in `src/styles.css`
- Icons: `lucide-react`
- Backend: Express + `pg`
- Database: PostgreSQL
- Database name: `DBWilliam`
- Schema: `rps`

## How To Run

From:

```powershell
cd "e:\Discovery AI\ProductionProcess"
```

Run API:

```powershell
$env:DATABASE_URL='postgresql://user:password@host:5432/database'
$env:API_PORT='3001'
$env:CLIENT_ORIGIN='http://localhost:5173'
npm.cmd run api
```

```powershell
$env:VITE_API_BASE_URL='http://localhost:3001/api'
npm.cmd run dev -- --host 0.0.0.0 --port 5173
```

URLs:

```text
Frontend: http://localhost:5173
API health: http://localhost:3001/api/health
```

## Current API Endpoints

```text
GET    /api/health
POST   /api/auth/login
GET    /api/master/bootstrap
POST   /api/executions/jumbo-roll
GET    /api/transactions?page=&pageSize=&search=
GET    /api/reports/jumbo-rolls?page=&pageSize=&search=&status=&productionLineCode=&gradeCode=&rawMaterialCode=&dateFrom=&dateTo=
GET    /api/reports/raw-material-movements?page=&pageSize=&movementType=&materialCode=&materialBatch=&rollNumber=&dateFrom=&dateTo=
GET    /api/dashboard/summary
GET    /api/dashboard/production-performance?period=&year=
GET    /api/activity-logs?page=&pageSize=&search=&eventType=&status=&userId=&entityType=&dateFrom=&dateTo=
POST   /api/activity-logs
PATCH  /api/transactions/:id/correction
POST   /api/transactions/:id/void
```

## Database Setup

Database used by the demo environment:

```text
Host: <postgres-host>
Port: 5432
Database: <database-name>
Schema: rps
User: <database-user>
Password: <database-password>
```

Setup/seed script:

```text
scripts/setup-rps-schema-and-seed.cjs
```

Read-only check script:

```text
scripts/check-postgres-readonly.cjs
```

Create database if missing:

```text
scripts/create-dbwilliam-if-missing.cjs
```

Activity log setup:

```text
scripts/setup-activity-log.cjs
```

Important safety rule: do not run destructive DB operations such as `DROP`, `TRUNCATE`, or broad `DELETE` unless explicitly requested.

## Seeded Master Data

Seed data exists for:

- employees
- users
- resources
- production lines
- shifts
- jumbo roll types
- grades
- raw materials
- raw material batches
- BOMs
- BOM materials
- process orders

Transactions are created through the web/API.

## Login Users

```text
operator   / operator123
supervisor / supervisor123
admin      / admin123
```

Login now requires API/PostgreSQL. No local dummy fallback should be used.

## Business Rules

Execution Jumbo Roll:

- One execution creates one jumbo roll result.
- Production line code is alphanumeric, length 1-2.
- Jumbo roll code is alphanumeric, length 3.
- Grade code is alphanumeric, length 2 and validated against master grade.
- Resource follows selected production line.
- Operator follows logged-in user.
- PRO is optional.
- BOM must be active.
- One active default BOM per jumbo roll is enforced in DB with partial unique index.
- Raw material can use multiple batches.
- Batch material must match BOM material.
- Actual material quantity total per material must be within -5% to +10% of BOM planning quantity.
- Batch quantity cannot exceed available stock.
- Successful execution:
  - creates roll number,
  - creates 10-digit jumbo batch number,
  - inserts transaction,
  - inserts material consumption,
  - deducts raw material batch stock,
  - creates stock movement.

Roll number format:

```text
[production line] [jumbo roll code] [MMY] [grade] [running 3 digit]
```

Example:

```text
L1 P12 056 A1 001
```

Jumbo batch number:

```text
10-digit numeric increment, starting from 0000000001
```

## Correction And Void

Correction:

- API endpoint: `PATCH /api/transactions/:id/correction`
- Only allowed for completed transactions.
- Does not change material consumption, BOM, production line, roll number, or jumbo batch number.
- Inserts row into `rps.correction_histories`.
- Increments transaction revision.

Void:

- API endpoint: `POST /api/transactions/:id/void`
- Only allowed for completed transactions.
- Requires reason and active employee NIK.
- Updates transaction status to `voided`.
- Creates `void_reversal` stock movements.
- Restores raw material batch stock.
- Roll number is never reused.

## Frontend UX Notes

- Dashboard has:
  - Operational Summary,
  - Production Monitoring,
  - Quick Actions.
- Mobile has compact top navigation.
- Transaction List uses table on desktop and cards on mobile.
- Transaction List uses server-side pagination and debounced search with an inline loading spinner in the search field.
- Jumbo Roll Report uses server-side pagination/filtering with an explicit Search button.
- Raw Material Movement uses server-side pagination/filtering with an explicit Search button.
- Activity Log menu shows API-backed audit events with pagination and filters.
- Dashboard has a Production Performance SVG line chart backed by aggregated API data.
- Dashboard KPI cards are backed by `/api/dashboard/summary` so totals are not based on the currently loaded transaction page.
- Modal dialogs use sticky header/action areas, stronger void warning, execution material review, and correction change preview.
- Report filters include Reset controls.
- Loading modals exist for login/navigation/API actions.
- Notification modal exists for success/error.
- API success banner was removed. API status is only shown if checking/error.
- If API/PostgreSQL is unavailable, the web should show errors instead of using local fallback.

## Important Files

```text
src/App.tsx
src/business.ts
src/data.ts
src/styles.css
server/index.cjs
server/db.cjs
server/activity-log.cjs
scripts/create-search-indexes.cjs
scripts/create-yearly-jumbo-transactions.cjs
scripts/setup-activity-log.cjs
docs/database-setup.md
docs/functional-spec.md
docs/glossary.md
docs/transaction-scenarios.md
PROJECT_NOTES.md
```

## Verification Commands

Build frontend:

```powershell
npm.cmd run build
```

Check API:

```powershell
Invoke-RestMethod http://localhost:3001/api/health
```

Check latest DB transactions:

```sql
SELECT id, status, roll_number, jumbo_batch_number, created_at
FROM rps.production_transactions
ORDER BY created_at DESC
LIMIT 10;
```

Check stock movements:

```sql
SELECT movement_type, transaction_id, material_code, material_batch, quantity, created_at
FROM rps.stock_movements
ORDER BY created_at DESC
LIMIT 20;
```

## Current Outstanding

Recommended next improvements:

1. Add CSV/Excel export for reports.
2. Add CRUD master data screens, especially BOM and raw material batch.
3. Add real auth hardening:
   - hashed password,
   - token/session,
   - authorization middleware.
4. Add a dedicated DB user instead of demo `postgres`.
5. Add automated npm script for scenario tests.
6. Add demo guide for end-to-end usage.
7. Add production-grade logging/error handling in Express API.

## Bulk 100 Transaction Simulation

On 2026-05-20 a temporary database bulk simulation was used to create 100 transactions. The temporary script has been removed before git cleanup because it was superseded by the yearly seed script.

The simulation created production transactions directly in `DBWilliam.rps` and checked raw material stock before each transaction. If a material batch was insufficient, it created a `stock_receipt` movement and updated batch stock before continuing production consumption.

Important database adjustment:

- `rps.stock_movements.transaction_id` is nullable for non-production movements such as `stock_receipt`.
- `rps.stock_movements.reference_roll_number` is nullable for `stock_receipt`.
- `rps.stock_movements.reference_jumbo_batch` is nullable for `stock_receipt`.

Latest executed summary:

```text
Requested transactions : 100
Created transactions   : 100
Created stock receipts : 8
Last jumbo batch       : 0000000104
Completed transactions : 103
Voided transactions    : 1
```

## Search And Pagination

On 2026-05-20 server-side search and pagination were added for:

- Transaction List
- Jumbo Roll Report
- Raw Material Movement

The helper script below creates/verifies non-destructive indexes for these screens:

```text
scripts/create-search-indexes.cjs
```

The UI intentionally uses two search patterns:

- Transaction List: debounced search because the search is simple and frequently typed.
- Report screens: explicit Search button because filters are more complex and should not call the API on every keystroke.

## Activity Log

On 2026-05-20 an API-backed activity log was added.

Database table:

```text
rps.activity_logs
```

Backend files:

```text
server/activity-log.cjs
server/index.cjs
```

Frontend menu:

```text
Activity Log
```

Logged events currently include:

- `LOGIN_SUCCESS`
- `LOGIN_FAILED`
- `LOGOUT`
- `OPEN_PAGE`
- `EXECUTE_TRANSACTION_SUCCESS`
- `EXECUTE_TRANSACTION_FAILED`
- `CORRECT_TRANSACTION_SUCCESS`
- `CORRECT_TRANSACTION_FAILED`
- `VOID_TRANSACTION_SUCCESS`
- `VOID_TRANSACTION_FAILED`

Passwords are not stored in activity log metadata.

## Dashboard Performance Data

On 2026-05-20 a yearly transaction seed and dashboard performance API were added.

Seed script:

```text
scripts/create-yearly-jumbo-transactions.cjs
```

Executed seed:

```text
Year                 : 2026
Created transactions : 1403
Created void samples : 29
Created stock receipt: 36
```

The script is idempotent per year because it skips when rows with note `Yearly production performance seed 2026` already exist.

Dashboard API:

```text
GET /api/dashboard/production-performance?period=month&year=2026
```

Supported periods:

- `hour`
- `day`
- `week`
- `month`
- `year`

The Dashboard chart renders completed, voided, and net transaction trend without loading all transactions into the frontend.

## Notes For Future Sessions

If asked to run the app:

1. Check whether ports are active:

```powershell
netstat -ano | findstr "LISTENING" | findstr ":3001 :5173"
```

2. If inactive, run:

```powershell
$env:DATABASE_URL='postgresql://user:password@host:5432/database'
$env:API_PORT='3001'
$env:CLIENT_ORIGIN='http://localhost:5173'
npm.cmd run api
```

In another terminal:

```powershell
$env:VITE_API_BASE_URL='http://localhost:3001/api'
npm.cmd run dev -- --host 0.0.0.0 --port 5173
```

3. Verify:

```powershell
Invoke-RestMethod http://localhost:3001/api/health
Invoke-WebRequest -UseBasicParsing http://localhost:5173
```
