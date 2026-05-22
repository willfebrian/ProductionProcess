const { Client } = require("pg");

const client = new Client({
  connectionString:
    process.env.DATABASE_URL ||
    `postgresql://${process.env.PGUSER || "user"}:${process.env.PGPASSWORD || "password"}@${process.env.PGHOST || "host"}:${process.env.PGPORT || "5432"}/${process.env.PGDATABASE || "database"}`
});

const statements = [
  "create index if not exists idx_rps_production_transactions_created_at on rps.production_transactions (created_at desc)",
  "create index if not exists idx_rps_production_transactions_status on rps.production_transactions (status)",
  "create index if not exists idx_rps_production_transactions_line on rps.production_transactions (production_line_code)",
  "create index if not exists idx_rps_production_transactions_jumbo on rps.production_transactions (jumbo_roll_code)",
  "create index if not exists idx_rps_production_transactions_grade on rps.production_transactions (grade_code)",
  "create index if not exists idx_rps_production_transactions_production_date on rps.production_transactions (production_date_time)",
  "create index if not exists idx_rps_material_consumptions_transaction on rps.material_consumptions (transaction_id)",
  "create index if not exists idx_rps_material_consumptions_material on rps.material_consumptions (material_code)",
  "create index if not exists idx_rps_material_consumption_batches_consumption on rps.material_consumption_batches (material_consumption_id)",
  "create index if not exists idx_rps_material_consumption_batches_batch on rps.material_consumption_batches (batch)",
  "create index if not exists idx_rps_stock_movements_created_at on rps.stock_movements (created_at desc)",
  "create index if not exists idx_rps_stock_movements_type on rps.stock_movements (movement_type)",
  "create index if not exists idx_rps_stock_movements_material on rps.stock_movements (material_code)",
  "create index if not exists idx_rps_stock_movements_batch on rps.stock_movements (material_batch)",
  "create index if not exists idx_rps_stock_movements_reference_roll on rps.stock_movements (reference_roll_number)"
];

(async () => {
  await client.connect();
  for (const statement of statements) {
    await client.query(statement);
  }
  console.log(`Created/verified ${statements.length} search and pagination indexes.`);
  await client.end();
})().catch(async (error) => {
  console.error(error.message);
  await client.end().catch(() => undefined);
  process.exit(1);
});
