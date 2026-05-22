const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    process.env.POSTGRES_DATABASE_URL ||
    process.env.POSTGRES_DEMO_DATABASE_URL,
  host: process.env.PGHOST,
  port: process.env.PGPORT ? Number(process.env.PGPORT) : undefined,
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD
});

async function query(text, params) {
  return pool.query(text, params);
}

module.exports = { pool, query };
