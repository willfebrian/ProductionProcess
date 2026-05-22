# Database Setup Draft

Phase 1, Phase 2, dan Phase 3 REST API sudah disiapkan untuk health check, login, bootstrap master data, execution jumbo roll, transaction list, report movement, correction, dan void dari PostgreSQL `DBWilliam.rps`.

## Status Demo PostgreSQL

- Host: `<postgres-host>`
- Port: `5432`
- Database: `<database-name>`
- Schema aplikasi: `rps`
- User: `<database-user>`
- Script setup: `scripts/setup-rps-schema-and-seed.cjs`

Yang sudah dibuat di `DBWilliam.rps`:

- schema `rps`
- table master data
- table BOM/PRO/transaksi/movement/correction
- seed master data dari dummy app
- transaksi produksi dapat dibuat lewat `POST /api/executions/jumbo-roll`

## REST API

Endpoint yang tersedia:

- `GET /api/health`
- `POST /api/auth/login`
- `GET /api/master/bootstrap`
- `POST /api/executions/jumbo-roll`
- `GET /api/transactions`
- `GET /api/reports/jumbo-rolls`
- `GET /api/reports/raw-material-movements`
- `PATCH /api/transactions/:id/correction`
- `POST /api/transactions/:id/void`

Menjalankan API:

```powershell
$env:DATABASE_URL='postgresql://user:password@host:5432/database'
$env:API_PORT='3001'
$env:CLIENT_ORIGIN='http://localhost:5173'
npm.cmd run api
```

Menjalankan frontend:

```powershell
$env:VITE_API_BASE_URL='http://localhost:3001/api'
npm.cmd run dev -- --host 0.0.0.0 --port 5173
```

Catatan:

- Login frontend akan mencoba API terlebih dahulu.
- Master data form akan memakai `GET /api/master/bootstrap` jika API aktif.
- Submit execution akan memakai `POST /api/executions/jumbo-roll` jika API aktif.
- Transaction List dan Raw Material Movement akan membaca data dari API jika API aktif.
- Correction akan memakai `PATCH /api/transactions/:id/correction` jika API aktif.
- Void akan memakai `POST /api/transactions/:id/void` jika API aktif.
- Runtime frontend sekarang DB-only. Jika API/PostgreSQL tidak aktif, data lokal/dummy tidak dipakai untuk login, transaksi, report, atau master data.

## PostgreSQL

Yang perlu disiapkan:

- Host atau IP server.
- Port, default `5432`.
- Database name, contoh `roll_production_system`.
- Username dan password.
- Permission user untuk create/read/update/delete, dan migration jika nanti memakai ORM migration.
- SSL setting jika server mewajibkan SSL.

Contoh environment:

```env
DATABASE_PROVIDER="postgresql"
DATABASE_URL="postgresql://user:password@localhost:5432/roll_production_system"
POSTGRES_DEMO_DATABASE_URL="postgresql://user:password@host:5432/database"
POSTGRES_SCHEMA="rps"
```

## SQL Server

Yang perlu disiapkan:

- Host atau IP server.
- Port, default `1433`.
- Database name.
- Username dan password jika memakai SQL Authentication.
- Informasi apakah memakai SQL Authentication atau Windows Authentication.
- Encryption dan certificate setting.
- Permission user untuk table access dan migration.

Contoh environment:

```env
DATABASE_PROVIDER="sqlserver"
DATABASE_URL="sqlserver://localhost:1433;database=roll_production_system;user=sa;password=your_password;encrypt=true;trustServerCertificate=true"
```

## Rekomendasi Tabel

- `rps.users`
- `rps.employees`
- `rps.production_lines`
- `rps.resources`
- `rps.shifts`
- `rps.jumbo_roll_types`
- `rps.grades`
- `rps.raw_materials`
- `rps.raw_material_batches`
- `rps.boms`
- `rps.bom_materials`
- `rps.process_orders`
- `rps.production_transactions`
- `rps.material_consumptions`
- `rps.material_consumption_batches`
- `rps.stock_movements`
- `rps.correction_histories`

## Catatan Desain

- Nomor roll dan batch jumbo roll harus unique.
- Running number roll dihitung dari semua transaksi, termasuk voided.
- Void tidak menghapus transaksi, tetapi membuat reversal stock movement.
- Correction tidak boleh mengubah material consumption, BOM, line, roll number, dan jumbo batch number.
- `stock_receipt` movement boleh tidak memiliki `transaction_id`, `reference_roll_number`, dan `reference_jumbo_batch` karena receipt raw material tidak selalu berasal dari production transaction.
- Demo database memakai `postgres/postgres` sementara. Untuk pemakaian nyata, buat user aplikasi terbatas.
- Jangan menjalankan drop/truncate/delete pada database existing tanpa approval eksplisit.
