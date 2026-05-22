const { Client } = require("pg");

async function main() {
  const client = new Client({
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT || 5432),
    database: process.env.PGDATABASE || "postgres",
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    connectionTimeoutMillis: 10000
  });

  await client.connect();
  const info = await client.query(
    "select current_database() as database, current_user as user, version() as version"
  );
  const db = await client.query("select datname from pg_database where datname = $1", ["DBWilliam"]);
  console.log(
    JSON.stringify(
      {
        connection: info.rows[0],
        dbWilliamExists: db.rowCount > 0,
        dbWilliamRows: db.rows
      },
      null,
      2
    )
  );
  await client.end();
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
