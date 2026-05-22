const { Client } = require("pg");

const client = new Client({
  connectionString:
    process.env.DATABASE_URL ||
    `postgresql://${process.env.PGUSER || "user"}:${process.env.PGPASSWORD || "password"}@${process.env.PGHOST || "host"}:${process.env.PGPORT || "5432"}/${process.env.PGDATABASE || "database"}`
});

const statements = [
  `
    create table if not exists rps.activity_logs (
      id text primary key,
      event_type text not null,
      user_id text null,
      employee_nik text null,
      role text null,
      page text null,
      action text not null,
      entity_type text null,
      entity_id text null,
      status text not null check (status in ('success', 'failed', 'info')),
      message text null,
      metadata_json jsonb not null default '{}'::jsonb,
      ip_address text null,
      user_agent text null,
      created_at timestamptz not null default now()
    )
  `,
  "create index if not exists idx_rps_activity_logs_created_at on rps.activity_logs (created_at desc)",
  "create index if not exists idx_rps_activity_logs_event_type on rps.activity_logs (event_type)",
  "create index if not exists idx_rps_activity_logs_user_id on rps.activity_logs (user_id)",
  "create index if not exists idx_rps_activity_logs_status on rps.activity_logs (status)",
  "create index if not exists idx_rps_activity_logs_entity on rps.activity_logs (entity_type, entity_id)"
];

(async () => {
  await client.connect();
  for (const statement of statements) {
    await client.query(statement);
  }
  console.log("Activity log table and indexes are ready.");
  await client.end();
})().catch(async (error) => {
  console.error(error.message);
  await client.end().catch(() => undefined);
  process.exit(1);
});
