const { Client } = require("pg");

const employees = [
  ["100001", "Andi Pratama", "active"],
  ["100002", "Bunga Lestari", "active"],
  ["100003", "Citra Wijaya", "active"],
  ["900001", "Dewa Supervisor", "active"],
  ["900002", "Admin Produksi", "active"],
  ["800001", "Inactive Employee", "inactive"]
];

const users = [
  ["USR-OPR-01", "operator", "operator123", "operator", "100001"],
  ["USR-SPV-01", "supervisor", "supervisor123", "supervisor", "900001"],
  ["USR-ADM-01", "admin", "admin123", "admin", "900002"]
];

const resources = [
  ["RES-COAT-01", "Coating Resource 01"],
  ["RES-LAM-02", "Lamination Resource 02"],
  ["RES-TRIAL-09", "Trial Resource 09"],
  ["RES-MAN-07", "Manual Resource 07"]
];

const productionLines = [
  ["L1", "Line 1 Coating", "RES-COAT-01"],
  ["A2", "Line 2 Lamination", "RES-LAM-02"],
  ["X9", "Trial Line X9", "RES-TRIAL-09"],
  ["7", "Manual Line 7", "RES-MAN-07"]
];

const shifts = [
  ["S1", "Shift 1", "07:00", "15:00"],
  ["S2", "Shift 2", "15:00", "23:00"],
  ["S3", "Shift 3", "23:00", "07:00"]
];

const jumboRollTypes = [
  ["P12", "JR-PET12", "PET Film 12 Micron Jumbo Roll", "active"],
  ["B20", "JR-BOPP20", "BOPP Film 20 Micron Jumbo Roll", "active"],
  ["A07", "JR-ALU07", "Aluminium Foil 7 Micron Jumbo Roll", "active"],
  ["M15", "JR-MET15", "Metallized Film 15 Micron Jumbo Roll", "active"],
  ["Z99", "JR-OLD99", "Inactive legacy jumbo roll", "inactive"]
];

const grades = [
  ["A1", "Prime Grade", "Produk normal sesuai standar kualitas", "active"],
  ["B1", "Minor Defect", "Produk good dengan defect minor", "active"],
  ["C1", "Rework Grade", "Produk perlu proses lanjutan/rework", "active"],
  ["R1", "Reject Grade", "Produk reject", "active"],
  ["T1", "Trial Grade", "Produk hasil trial", "active"],
  ["X0", "Inactive Grade", "Grade tidak digunakan", "inactive"]
];

const rawMaterials = [
  ["PET", "PET Film Base 12 Micron", "KG"],
  ["BOP", "BOPP Film Base 20 Micron", "KG"],
  ["ALU", "Aluminium Foil 7 Micron", "KG"],
  ["MET", "Metallized Film Base 15 Micron", "KG"],
  ["ADH", "Solventless Adhesive", "KG"],
  ["SOL", "Process Solvent", "KG"],
  ["RES", "Coating Resin", "KG"]
];

const rawMaterialBatches = [
  ["PET-A2401", "PET", 520, "available"],
  ["PET-A2402", "PET", 430, "available"],
  ["BOP-B2401", "BOP", 610, "available"],
  ["ALU-C2401", "ALU", 380, "available"],
  ["MET-D2401", "MET", 460, "available"],
  ["ADH-E2401", "ADH", 240, "available"],
  ["ADH-E2402", "ADH", 180, "available"],
  ["SOL-F2401", "SOL", 150, "available"],
  ["RES-G2401", "RES", 260, "available"],
  ["PET-BLOCK", "PET", 100, "blocked"]
];

const boms = [
  ["BOM-P12-V01", "P12", "V01", "Standard PET 12 composition", "active", true],
  ["BOM-P12-V02", "P12", "V02", "Alternative PET 12 high adhesion", "active", false],
  ["BOM-P12-V99", "P12", "V99", "Inactive experimental PET BOM", "inactive", false],
  ["BOM-B20-V01", "B20", "V01", "Standard BOPP 20 composition", "active", true],
  ["BOM-A07-V01", "A07", "V01", "Standard aluminium foil composition", "active", true],
  ["BOM-M15-V01", "M15", "V01", "Standard metallized film composition", "active", true]
];

const bomMaterials = [
  ["BOM-P12-V01", "PET", 100, "KG"],
  ["BOM-P12-V01", "ADH", 22, "KG"],
  ["BOM-P12-V01", "SOL", 8, "KG"],
  ["BOM-P12-V02", "PET", 100, "KG"],
  ["BOM-P12-V02", "ADH", 28, "KG"],
  ["BOM-P12-V02", "RES", 12, "KG"],
  ["BOM-P12-V99", "PET", 90, "KG"],
  ["BOM-B20-V01", "BOP", 115, "KG"],
  ["BOM-B20-V01", "ADH", 18, "KG"],
  ["BOM-A07-V01", "ALU", 95, "KG"],
  ["BOM-A07-V01", "SOL", 7, "KG"],
  ["BOM-M15-V01", "MET", 108, "KG"],
  ["BOM-M15-V01", "RES", 16, "KG"]
];

const processOrders = [
  ["PRO-20260518-001", "released", "P12", 3, "ROLL", "2026-05-18", "2026-05-19", "BOM-P12-V01", "L1"],
  ["PRO-20260518-002", "in_progress", "B20", 2, "ROLL", "2026-05-18", "2026-05-18", "BOM-B20-V01", "A2"],
  ["PRO-20260517-009", "closed", "A07", 1, "ROLL", "2026-05-17", "2026-05-17", "BOM-A07-V01", "7"]
];

async function upsertMany(client, sql, rows) {
  for (const row of rows) {
    await client.query(sql, row);
  }
}

async function main() {
  const client = new Client({
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT || 5432),
    database: process.env.PGDATABASE || "DBWilliam",
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    connectionTimeoutMillis: 10000
  });

  await client.connect();
  await client.query("BEGIN");
  try {
    await client.query(`
      CREATE SCHEMA IF NOT EXISTS rps;

      CREATE TABLE IF NOT EXISTS rps.employees (
        nik varchar(20) PRIMARY KEY,
        name varchar(120) NOT NULL,
        status varchar(20) NOT NULL CHECK (status IN ('active', 'inactive'))
      );

      CREATE TABLE IF NOT EXISTS rps.users (
        id varchar(40) PRIMARY KEY,
        username varchar(80) NOT NULL UNIQUE,
        password varchar(120) NOT NULL,
        role varchar(20) NOT NULL CHECK (role IN ('operator', 'supervisor', 'admin')),
        employee_nik varchar(20) NOT NULL REFERENCES rps.employees(nik)
      );

      CREATE TABLE IF NOT EXISTS rps.resources (
        code varchar(30) PRIMARY KEY,
        name varchar(120) NOT NULL
      );

      CREATE TABLE IF NOT EXISTS rps.production_lines (
        code varchar(2) PRIMARY KEY,
        name varchar(120) NOT NULL,
        resource_code varchar(30) NOT NULL REFERENCES rps.resources(code),
        CONSTRAINT production_line_code_format CHECK (code ~ '^[A-Za-z0-9]{1,2}$')
      );

      CREATE TABLE IF NOT EXISTS rps.shifts (
        code varchar(10) PRIMARY KEY,
        name varchar(80) NOT NULL,
        start_time time NOT NULL,
        end_time time NOT NULL
      );

      CREATE TABLE IF NOT EXISTS rps.jumbo_roll_types (
        code varchar(3) PRIMARY KEY,
        type varchar(60) NOT NULL,
        description text NOT NULL,
        status varchar(20) NOT NULL CHECK (status IN ('active', 'inactive')),
        CONSTRAINT jumbo_roll_code_format CHECK (code ~ '^[A-Za-z0-9]{3}$')
      );

      CREATE TABLE IF NOT EXISTS rps.grades (
        code varchar(2) PRIMARY KEY,
        name varchar(80) NOT NULL,
        description text NOT NULL,
        status varchar(20) NOT NULL CHECK (status IN ('active', 'inactive')),
        CONSTRAINT grade_code_format CHECK (code ~ '^[A-Za-z0-9]{2}$')
      );

      CREATE TABLE IF NOT EXISTS rps.raw_materials (
        code varchar(20) PRIMARY KEY,
        description text NOT NULL,
        unit varchar(10) NOT NULL CHECK (unit = 'KG')
      );

      CREATE TABLE IF NOT EXISTS rps.raw_material_batches (
        batch varchar(40) PRIMARY KEY,
        material_code varchar(20) NOT NULL REFERENCES rps.raw_materials(code),
        available_qty numeric(14,3) NOT NULL CHECK (available_qty >= 0),
        status varchar(20) NOT NULL CHECK (status IN ('available', 'blocked'))
      );

      CREATE TABLE IF NOT EXISTS rps.boms (
        bom_code varchar(40) PRIMARY KEY,
        jumbo_roll_code varchar(3) NOT NULL REFERENCES rps.jumbo_roll_types(code),
        version varchar(10) NOT NULL,
        description text NOT NULL,
        status varchar(20) NOT NULL CHECK (status IN ('active', 'inactive')),
        is_default boolean NOT NULL DEFAULT false
      );

      CREATE UNIQUE INDEX IF NOT EXISTS boms_one_active_default_per_jumbo
        ON rps.boms (jumbo_roll_code)
        WHERE status = 'active' AND is_default = true;

      CREATE TABLE IF NOT EXISTS rps.bom_materials (
        bom_code varchar(40) NOT NULL REFERENCES rps.boms(bom_code),
        material_code varchar(20) NOT NULL REFERENCES rps.raw_materials(code),
        planning_qty numeric(14,3) NOT NULL CHECK (planning_qty > 0),
        unit varchar(10) NOT NULL CHECK (unit = 'KG'),
        PRIMARY KEY (bom_code, material_code)
      );

      CREATE TABLE IF NOT EXISTS rps.process_orders (
        pro_number varchar(40) PRIMARY KEY,
        status varchar(20) NOT NULL CHECK (status IN ('created', 'released', 'in_progress', 'completed', 'closed', 'cancelled')),
        jumbo_roll_code varchar(3) NOT NULL REFERENCES rps.jumbo_roll_types(code),
        planned_good_qty numeric(14,3) NOT NULL CHECK (planned_good_qty >= 0),
        planned_unit varchar(10) NOT NULL CHECK (planned_unit = 'ROLL'),
        planned_start_date date NOT NULL,
        planned_end_date date NOT NULL,
        default_bom_code varchar(40) NOT NULL REFERENCES rps.boms(bom_code),
        production_line_code varchar(2) NOT NULL REFERENCES rps.production_lines(code)
      );

      CREATE TABLE IF NOT EXISTS rps.production_transactions (
        id varchar(60) PRIMARY KEY,
        status varchar(20) NOT NULL CHECK (status IN ('completed', 'voided')),
        output_status varchar(20) NOT NULL CHECK (output_status IN ('GOOD', 'REJECT')),
        roll_number varchar(80) NOT NULL UNIQUE,
        jumbo_batch_number varchar(10) NOT NULL UNIQUE,
        pro_number varchar(40) REFERENCES rps.process_orders(pro_number),
        production_line_code varchar(2) NOT NULL REFERENCES rps.production_lines(code),
        resource_code varchar(30) NOT NULL REFERENCES rps.resources(code),
        shift_code varchar(10) NOT NULL REFERENCES rps.shifts(code),
        operator_user_id varchar(40) NOT NULL REFERENCES rps.users(id),
        operator_employee_nik varchar(20) NOT NULL REFERENCES rps.employees(nik),
        jumbo_roll_code varchar(3) NOT NULL REFERENCES rps.jumbo_roll_types(code),
        bom_code varchar(40) NOT NULL REFERENCES rps.boms(bom_code),
        production_date_time timestamptz NOT NULL,
        created_at timestamptz NOT NULL,
        created_by_user_id varchar(40) NOT NULL REFERENCES rps.users(id),
        confirmed_employee_nik varchar(20) NOT NULL REFERENCES rps.employees(nik),
        actual_length_m numeric(14,3) NOT NULL CHECK (actual_length_m > 0),
        actual_width_mm numeric(14,3) NOT NULL CHECK (actual_width_mm > 0),
        actual_weight_kg numeric(14,3) NOT NULL CHECK (actual_weight_kg > 0),
        grade_code varchar(2) NOT NULL REFERENCES rps.grades(code),
        good_qty numeric(14,3) NOT NULL DEFAULT 1,
        reject_qty numeric(14,3) NOT NULL DEFAULT 0,
        output_unit varchar(10) NOT NULL CHECK (output_unit = 'ROLL'),
        notes text,
        revision integer NOT NULL DEFAULT 1,
        void_reason text,
        voided_at timestamptz,
        voided_by_user_id varchar(40) REFERENCES rps.users(id),
        void_approved_employee_nik varchar(20) REFERENCES rps.employees(nik),
        replacement_of_transaction_id varchar(60) REFERENCES rps.production_transactions(id),
        replacement_of_roll_number varchar(80),
        replaced_by_transaction_id varchar(60) REFERENCES rps.production_transactions(id),
        replaced_by_roll_number varchar(80)
      );

      CREATE TABLE IF NOT EXISTS rps.material_consumptions (
        id bigserial PRIMARY KEY,
        transaction_id varchar(60) NOT NULL REFERENCES rps.production_transactions(id),
        material_code varchar(20) NOT NULL REFERENCES rps.raw_materials(code),
        planning_qty numeric(14,3) NOT NULL CHECK (planning_qty > 0),
        unit varchar(10) NOT NULL CHECK (unit = 'KG'),
        UNIQUE (transaction_id, material_code)
      );

      CREATE TABLE IF NOT EXISTS rps.material_consumption_batches (
        id bigserial PRIMARY KEY,
        material_consumption_id bigint NOT NULL REFERENCES rps.material_consumptions(id),
        batch varchar(40) NOT NULL REFERENCES rps.raw_material_batches(batch),
        quantity numeric(14,3) NOT NULL CHECK (quantity > 0),
        UNIQUE (material_consumption_id, batch)
      );

      CREATE TABLE IF NOT EXISTS rps.stock_movements (
        id varchar(80) PRIMARY KEY,
        movement_type varchar(40) NOT NULL CHECK (movement_type IN ('production_consumption', 'void_reversal', 'stock_adjustment', 'stock_receipt')),
        transaction_id varchar(60) NOT NULL REFERENCES rps.production_transactions(id),
        material_code varchar(20) NOT NULL REFERENCES rps.raw_materials(code),
        material_batch varchar(40) NOT NULL REFERENCES rps.raw_material_batches(batch),
        quantity numeric(14,3) NOT NULL,
        unit varchar(10) NOT NULL CHECK (unit = 'KG'),
        before_qty numeric(14,3) NOT NULL,
        after_qty numeric(14,3) NOT NULL,
        reference_roll_number varchar(80) NOT NULL,
        reference_jumbo_batch varchar(10) NOT NULL,
        created_at timestamptz NOT NULL,
        created_by_user_id varchar(40) NOT NULL REFERENCES rps.users(id)
      );

      CREATE TABLE IF NOT EXISTS rps.correction_histories (
        id bigserial PRIMARY KEY,
        transaction_id varchar(60) NOT NULL REFERENCES rps.production_transactions(id),
        corrected_at timestamptz NOT NULL,
        corrected_by_user_id varchar(40) NOT NULL REFERENCES rps.users(id),
        approved_employee_nik varchar(20) NOT NULL REFERENCES rps.employees(nik),
        reason text NOT NULL,
        before_data jsonb NOT NULL,
        after_data jsonb NOT NULL
      );
    `);

    await upsertMany(client, `INSERT INTO rps.employees (nik, name, status) VALUES ($1, $2, $3)
      ON CONFLICT (nik) DO UPDATE SET name = EXCLUDED.name, status = EXCLUDED.status`, employees);
    await upsertMany(client, `INSERT INTO rps.users (id, username, password, role, employee_nik) VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (id) DO UPDATE SET username = EXCLUDED.username, password = EXCLUDED.password, role = EXCLUDED.role, employee_nik = EXCLUDED.employee_nik`, users);
    await upsertMany(client, `INSERT INTO rps.resources (code, name) VALUES ($1, $2)
      ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name`, resources);
    await upsertMany(client, `INSERT INTO rps.production_lines (code, name, resource_code) VALUES ($1, $2, $3)
      ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, resource_code = EXCLUDED.resource_code`, productionLines);
    await upsertMany(client, `INSERT INTO rps.shifts (code, name, start_time, end_time) VALUES ($1, $2, $3, $4)
      ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time`, shifts);
    await upsertMany(client, `INSERT INTO rps.jumbo_roll_types (code, type, description, status) VALUES ($1, $2, $3, $4)
      ON CONFLICT (code) DO UPDATE SET type = EXCLUDED.type, description = EXCLUDED.description, status = EXCLUDED.status`, jumboRollTypes);
    await upsertMany(client, `INSERT INTO rps.grades (code, name, description, status) VALUES ($1, $2, $3, $4)
      ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, status = EXCLUDED.status`, grades);
    await upsertMany(client, `INSERT INTO rps.raw_materials (code, description, unit) VALUES ($1, $2, $3)
      ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description, unit = EXCLUDED.unit`, rawMaterials);
    await upsertMany(client, `INSERT INTO rps.raw_material_batches (batch, material_code, available_qty, status) VALUES ($1, $2, $3, $4)
      ON CONFLICT (batch) DO UPDATE SET material_code = EXCLUDED.material_code, available_qty = EXCLUDED.available_qty, status = EXCLUDED.status`, rawMaterialBatches);
    await upsertMany(client, `INSERT INTO rps.boms (bom_code, jumbo_roll_code, version, description, status, is_default) VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (bom_code) DO UPDATE SET jumbo_roll_code = EXCLUDED.jumbo_roll_code, version = EXCLUDED.version, description = EXCLUDED.description, status = EXCLUDED.status, is_default = EXCLUDED.is_default`, boms);
    await upsertMany(client, `INSERT INTO rps.bom_materials (bom_code, material_code, planning_qty, unit) VALUES ($1, $2, $3, $4)
      ON CONFLICT (bom_code, material_code) DO UPDATE SET planning_qty = EXCLUDED.planning_qty, unit = EXCLUDED.unit`, bomMaterials);
    await upsertMany(client, `INSERT INTO rps.process_orders (pro_number, status, jumbo_roll_code, planned_good_qty, planned_unit, planned_start_date, planned_end_date, default_bom_code, production_line_code)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (pro_number) DO UPDATE SET status = EXCLUDED.status, jumbo_roll_code = EXCLUDED.jumbo_roll_code, planned_good_qty = EXCLUDED.planned_good_qty, planned_unit = EXCLUDED.planned_unit, planned_start_date = EXCLUDED.planned_start_date, planned_end_date = EXCLUDED.planned_end_date, default_bom_code = EXCLUDED.default_bom_code, production_line_code = EXCLUDED.production_line_code`, processOrders);

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }

  const counts = await client.query(`
    SELECT 'employees' AS table_name, COUNT(*)::int AS row_count FROM rps.employees
    UNION ALL SELECT 'users', COUNT(*)::int FROM rps.users
    UNION ALL SELECT 'resources', COUNT(*)::int FROM rps.resources
    UNION ALL SELECT 'production_lines', COUNT(*)::int FROM rps.production_lines
    UNION ALL SELECT 'shifts', COUNT(*)::int FROM rps.shifts
    UNION ALL SELECT 'jumbo_roll_types', COUNT(*)::int FROM rps.jumbo_roll_types
    UNION ALL SELECT 'grades', COUNT(*)::int FROM rps.grades
    UNION ALL SELECT 'raw_materials', COUNT(*)::int FROM rps.raw_materials
    UNION ALL SELECT 'raw_material_batches', COUNT(*)::int FROM rps.raw_material_batches
    UNION ALL SELECT 'boms', COUNT(*)::int FROM rps.boms
    UNION ALL SELECT 'bom_materials', COUNT(*)::int FROM rps.bom_materials
    UNION ALL SELECT 'process_orders', COUNT(*)::int FROM rps.process_orders
    UNION ALL SELECT 'production_transactions', COUNT(*)::int FROM rps.production_transactions
    UNION ALL SELECT 'stock_movements', COUNT(*)::int FROM rps.stock_movements
  `);

  console.log(JSON.stringify({ schema: "rps", counts: counts.rows }, null, 2));
  await client.end();
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
