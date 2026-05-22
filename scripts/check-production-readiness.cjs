const { Client } = require("pg");

async function main() {
  const client = new Client({
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT || 5432),
    database: process.env.PGDATABASE || "DBWilliam",
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD
  });

  await client.connect();
  const columns = await client.query(`
    select column_name, is_nullable, data_type
    from information_schema.columns
    where table_schema = 'rps' and table_name = 'stock_movements'
    order by ordinal_position
  `);
  const counts = await client.query(`
    select status, count(*)::int as row_count
    from rps.production_transactions
    group by status
    order by status
  `);
  const stock = await client.query(`
    select material_code, sum(available_qty)::float as total_qty
    from rps.raw_material_batches
    where status = 'available'
    group by material_code
    order by material_code
  `);

  console.log(JSON.stringify({
    stockMovementColumns: columns.rows,
    transactionCounts: counts.rows,
    stock: stock.rows
  }, null, 2));

  await client.end();
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
