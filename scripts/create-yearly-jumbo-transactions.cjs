const { Client } = require("pg");

const YEAR = Number(process.argv[2] || 2026);
const MIN_DAILY = Number(process.argv[3] || 2);
const MAX_DAILY = Number(process.argv[4] || 6);
const RECEIPT_MIN_QTY = 5000;
const createdByUserId = "USR-ADM-01";
const confirmedEmployeeNik = "900002";
const shifts = ["S1", "S2", "S3"];
const grades = ["A1", "B1", "T1", "A1", "B1"];

const pad = (value, size) => String(value).padStart(size, "0");
const getMonthYearCode = (isoDate) => {
  const date = new Date(isoDate);
  return `${pad(date.getUTCMonth() + 1, 2)}${String(date.getUTCFullYear()).slice(-1)}`;
};

async function ensureReceiptSupport(client) {
  await client.query(`
    alter table rps.stock_movements alter column transaction_id drop not null;
    alter table rps.stock_movements alter column reference_roll_number drop not null;
    alter table rps.stock_movements alter column reference_jumbo_batch drop not null;
  `);
}

async function getNextRollNumber(client, productionLineCode, jumboRollCode, gradeCode, productionDateTime) {
  const monthYearCode = getMonthYearCode(productionDateTime);
  const prefix = `${productionLineCode} ${jumboRollCode} ${monthYearCode}`;
  const result = await client.query("select roll_number from rps.production_transactions where roll_number like $1", [
    `${prefix}%`
  ]);
  const maxRunning = result.rows.reduce((max, row) => {
    const running = Number(String(row.roll_number).split(" ").pop());
    return Number.isFinite(running) ? Math.max(max, running) : max;
  }, 0);
  return `${prefix} ${gradeCode} ${pad(maxRunning + 1, 3)}`;
}

async function getNextJumboBatch(client) {
  const result = await client.query(
    "select coalesce(max(jumbo_batch_number::bigint), 0) + 1 as next_batch from rps.production_transactions"
  );
  return pad(result.rows[0].next_batch, 10);
}

async function receiveIfNeeded(client, materialCode, neededQty, receiptNo, receiptDate) {
  const batchResult = await client.query(
    `
      select batch, available_qty::float
      from rps.raw_material_batches
      where material_code = $1 and status = 'available'
      order by available_qty desc, batch
      limit 1
      for update
    `,
    [materialCode]
  );
  if (!batchResult.rowCount) throw new Error(`No available batch for ${materialCode}`);

  const batch = batchResult.rows[0];
  if (Number(batch.available_qty) >= neededQty) return { batch: batch.batch, receiptCreated: false };

  const receiptQty = Math.max(RECEIPT_MIN_QTY, neededQty * 40);
  const beforeQty = Number(batch.available_qty);
  const afterQty = Number((beforeQty + receiptQty).toFixed(3));
  const receiptId = `RCPT-YEAR-${YEAR}-${receiptNo}`;

  await client.query("update rps.raw_material_batches set available_qty = $1 where batch = $2", [afterQty, batch.batch]);
  await client.query(
    `
      insert into rps.stock_movements (
        id, movement_type, transaction_id, material_code, material_batch, quantity,
        unit, before_qty, after_qty, reference_roll_number, reference_jumbo_batch,
        created_at, created_by_user_id
      )
      values ($1, 'stock_receipt', null, $2, $3, $4, 'KG', $5, $6, $7, null, $8, $9)
    `,
    [
      `MOV-${receiptId}`,
      materialCode,
      batch.batch,
      receiptQty,
      beforeQty,
      afterQty,
      receiptId,
      receiptDate,
      createdByUserId
    ]
  );
  return { batch: batch.batch, receiptCreated: true, receiptQty };
}

function dailyTarget(date) {
  const day = date.getUTCDay();
  const weekendAdjustment = day === 0 ? -2 : day === 6 ? -1 : 0;
  const seasonal = date.getUTCMonth() >= 9 ? 1 : 0;
  const wave = (date.getUTCDate() + date.getUTCMonth()) % (MAX_DAILY - MIN_DAILY + 1);
  return Math.max(1, MIN_DAILY + wave + weekendAdjustment + seasonal);
}

async function main() {
  const client = new Client({
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT || 5432),
    database: process.env.PGDATABASE || "DBWilliam",
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD
  });

  await client.connect();
  await ensureReceiptSupport(client);

  const existing = await client.query(
    "select count(*)::int as row_count from rps.production_transactions where notes = $1",
    [`Yearly production performance seed ${YEAR}`]
  );
  if (existing.rows[0].row_count > 0) {
    console.log(JSON.stringify({ skipped: true, reason: `Yearly seed ${YEAR} already exists`, existingRows: existing.rows[0].row_count }, null, 2));
    await client.end();
    return;
  }

  const [bomResult, lineResult, operatorResult] = await Promise.all([
    client.query("select bom_code, jumbo_roll_code from rps.boms where status = 'active' order by bom_code"),
    client.query("select code, resource_code from rps.production_lines order by code"),
    client.query("select employee_nik, role from rps.users where id = $1", [createdByUserId])
  ]);
  if (!bomResult.rowCount) throw new Error("No active BOM found.");
  if (!lineResult.rowCount) throw new Error("No production line found.");
  if (!operatorResult.rowCount) throw new Error(`User ${createdByUserId} not found.`);

  const boms = bomResult.rows;
  const lines = lineResult.rows;
  const operatorNik = operatorResult.rows[0].employee_nik;
  const summary = {
    year: YEAR,
    createdTransactions: 0,
    createdVoids: 0,
    createdReceipts: 0,
    receiptQtyByMaterial: {},
    monthly: {}
  };

  let sequence = 1;
  let receiptNo = 1;
  for (let month = 0; month < 12; month += 1) {
    const daysInMonth = new Date(Date.UTC(YEAR, month + 1, 0)).getUTCDate();
    for (let day = 1; day <= daysInMonth; day += 1) {
      const baseDate = new Date(Date.UTC(YEAR, month, day));
      const count = dailyTarget(baseDate);
      for (let dailyIndex = 0; dailyIndex < count; dailyIndex += 1) {
        const bom = boms[sequence % boms.length];
        const line = lines[sequence % lines.length];
        const shiftCode = shifts[sequence % shifts.length];
        const gradeCode = grades[sequence % grades.length];
        const productionDateTime = new Date(Date.UTC(YEAR, month, day, 1 + (dailyIndex * 3) % 22, (sequence * 7) % 60, 0)).toISOString();
        const createdAt = new Date(new Date(productionDateTime).getTime() + 4 * 60 * 1000).toISOString();
        const status = sequence % 47 === 0 ? "voided" : "completed";
        const voidedAt = status === "voided" ? new Date(new Date(createdAt).getTime() + 45 * 60 * 1000).toISOString() : null;
        const bomMaterials = await client.query(
          "select material_code, planning_qty::float from rps.bom_materials where bom_code = $1 order by material_code",
          [bom.bom_code]
        );

        await client.query("BEGIN");
        try {
          const consumptions = [];
          for (const material of bomMaterials.rows) {
            const qty = Number((Number(material.planning_qty) * (0.98 + (sequence % 5) * 0.01)).toFixed(3));
            const receiptResult = await receiveIfNeeded(client, material.material_code, qty, receiptNo++, productionDateTime);
            if (receiptResult.receiptCreated) {
              summary.createdReceipts += 1;
              summary.receiptQtyByMaterial[material.material_code] =
                (summary.receiptQtyByMaterial[material.material_code] || 0) + receiptResult.receiptQty;
            }
            consumptions.push({ materialCode: material.material_code, planningQty: Number(material.planning_qty), batch: receiptResult.batch, quantity: qty });
          }

          const rollNumber = await getNextRollNumber(client, line.code, bom.jumbo_roll_code, gradeCode, productionDateTime);
          const jumboBatchNumber = await getNextJumboBatch(client);
          const transactionId = `TRX-YEAR-${YEAR}-${pad(sequence, 6)}`;
          await client.query(
            `
              insert into rps.production_transactions (
                id, status, output_status, roll_number, jumbo_batch_number, pro_number,
                production_line_code, resource_code, shift_code, operator_user_id,
                operator_employee_nik, jumbo_roll_code, bom_code, production_date_time,
                created_at, created_by_user_id, confirmed_employee_nik, actual_length_m,
                actual_width_mm, actual_weight_kg, grade_code, good_qty, reject_qty,
                output_unit, notes, revision, void_reason, voided_at, voided_by_user_id,
                void_approved_employee_nik
              )
              values ($1,$2,'GOOD',$3,$4,null,$5,$6,$7,$8,$9,$10,$11,$12,$13,$8,$14,$15,$16,$17,$18,1,0,'ROLL',$19,1,$20,$21,$22,$23)
            `,
            [
              transactionId,
              status,
              rollNumber,
              jumboBatchNumber,
              line.code,
              line.resource_code,
              shiftCode,
              createdByUserId,
              operatorNik,
              bom.jumbo_roll_code,
              bom.bom_code,
              productionDateTime,
              createdAt,
              confirmedEmployeeNik,
              5900 + (sequence % 18) * 8,
              1180 + (sequence % 4) * 10,
              485 + (sequence % 22),
              gradeCode,
              `Yearly production performance seed ${YEAR}`,
              status === "voided" ? "Yearly seed sample void" : null,
              voidedAt,
              status === "voided" ? createdByUserId : null,
              status === "voided" ? confirmedEmployeeNik : null
            ]
          );

          let movementIndex = 1;
          for (const consumption of consumptions) {
            const mc = await client.query(
              "insert into rps.material_consumptions (transaction_id, material_code, planning_qty, unit) values ($1,$2,$3,'KG') returning id",
              [transactionId, consumption.materialCode, consumption.planningQty]
            );
            const batch = await client.query("select available_qty::float from rps.raw_material_batches where batch = $1 for update", [
              consumption.batch
            ]);
            const beforeQty = Number(batch.rows[0].available_qty);
            const afterQty = Number((beforeQty - consumption.quantity).toFixed(3));
            if (afterQty < 0) throw new Error(`Negative stock for ${consumption.batch}`);
            await client.query("insert into rps.material_consumption_batches (material_consumption_id, batch, quantity) values ($1,$2,$3)", [
              mc.rows[0].id,
              consumption.batch,
              consumption.quantity
            ]);
            await client.query("update rps.raw_material_batches set available_qty = $1 where batch = $2", [afterQty, consumption.batch]);
            await client.query(
              `
                insert into rps.stock_movements (
                  id, movement_type, transaction_id, material_code, material_batch, quantity,
                  unit, before_qty, after_qty, reference_roll_number, reference_jumbo_batch,
                  created_at, created_by_user_id
                )
                values ($1,'production_consumption',$2,$3,$4,$5,'KG',$6,$7,$8,$9,$10,$11)
              `,
              [
                `MOV-YEAR-${YEAR}-${pad(sequence, 6)}-${movementIndex++}`,
                transactionId,
                consumption.materialCode,
                consumption.batch,
                -consumption.quantity,
                beforeQty,
                afterQty,
                rollNumber,
                jumboBatchNumber,
                createdAt,
                createdByUserId
              ]
            );
          }

          await client.query("COMMIT");
          const monthKey = `${YEAR}-${pad(month + 1, 2)}`;
          summary.monthly[monthKey] = summary.monthly[monthKey] || { completed: 0, voided: 0 };
          summary.monthly[monthKey][status] += 1;
          summary.createdTransactions += 1;
          if (status === "voided") summary.createdVoids += 1;
          sequence += 1;
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        }
      }
    }
  }

  console.log(JSON.stringify(summary, null, 2));
  await client.end();
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
