const { Client } = require("pg");

async function main() {
  const client = new Client({
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT || 5432),
    database: "postgres",
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    connectionTimeoutMillis: 10000
  });

  await client.connect();
  const existing = await client.query("select datname from pg_database where datname = $1", ["DBWilliam"]);
  if (existing.rowCount > 0) {
    console.log(JSON.stringify({ created: false, message: "Database DBWilliam already exists." }, null, 2));
    await client.end();
    return;
  }

  await client.query('CREATE DATABASE "DBWilliam" TEMPLATE template0 ENCODING \'UTF8\'');
  console.log(JSON.stringify({ created: true, message: "Database DBWilliam created." }, null, 2));
  await client.end();
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
