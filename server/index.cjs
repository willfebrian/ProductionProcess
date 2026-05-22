const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { query } = require("./db.cjs");
const { getRequestContext, safeLogActivity, toActivityLog } = require("./activity-log.cjs");

const app = express();
const port = Number(process.env.API_PORT || 3001);

app.use(cors({ origin: process.env.CLIENT_ORIGIN || "http://localhost:5173" }));
app.use(express.json());

const mapRows = (rows, mapper) => rows.map(mapper);

const pad = (value, size) => String(value).padStart(size, "0");
const getMonthYearCode = (isoDate) => {
  const date = new Date(isoDate);
  return `${pad(date.getMonth() + 1, 2)}${String(date.getFullYear()).slice(-1)}`;
};

const parsePositiveInt = (value, fallback, max) => {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number) || number < 1) return fallback;
  return Math.min(number, max);
};

const getPagination = (queryParams) => {
  const page = parsePositiveInt(queryParams.page, 1, 100000);
  const pageSize = parsePositiveInt(queryParams.pageSize, 25, 100);
  return { page, pageSize, offset: (page - 1) * pageSize };
};

const emptyPagination = (page, pageSize, totalRows) => ({
  page,
  pageSize,
  totalRows,
  totalPages: Math.max(1, Math.ceil(totalRows / pageSize))
});

const toTransaction = (row, consumptions = []) => ({
  id: row.id,
  status: row.status,
  outputStatus: row.output_status,
  rollNumber: row.roll_number,
  jumboBatchNumber: row.jumbo_batch_number,
  proNumber: row.pro_number || undefined,
  productionLineCode: row.production_line_code,
  resourceCode: row.resource_code,
  shiftCode: row.shift_code,
  operatorUserId: row.operator_user_id,
  operatorEmployeeNik: row.operator_employee_nik,
  jumboRollCode: row.jumbo_roll_code,
  bomCode: row.bom_code,
  productionDateTime: row.production_date_time,
  createdAt: row.created_at,
  createdByUserId: row.created_by_user_id,
  confirmedEmployeeNik: row.confirmed_employee_nik,
  actualLengthM: Number(row.actual_length_m),
  actualWidthMm: Number(row.actual_width_mm),
  actualWeightKg: Number(row.actual_weight_kg),
  gradeCode: row.grade_code,
  goodQty: Number(row.good_qty),
  rejectQty: Number(row.reject_qty),
  outputUnit: row.output_unit,
  notes: row.notes || undefined,
  rawMaterialConsumptions: consumptions,
  revision: row.revision,
  correctionHistory: [],
  voidReason: row.void_reason || undefined,
  voidedAt: row.voided_at || undefined,
  voidedByUserId: row.voided_by_user_id || undefined,
  voidApprovedEmployeeNik: row.void_approved_employee_nik || undefined,
  replacementOfTransactionId: row.replacement_of_transaction_id || undefined,
  replacementOfRollNumber: row.replacement_of_roll_number || undefined,
  replacedByTransactionId: row.replaced_by_transaction_id || undefined,
  replacedByRollNumber: row.replaced_by_roll_number || undefined
});

async function loadTransactions(client, where = "", params = [], pagination = null) {
  const limitClause = pagination ? `limit $${params.length + 1} offset $${params.length + 2}` : "";
  const queryParams = pagination ? [...params, pagination.pageSize, pagination.offset] : params;
  const trxResult = await client.query(
    `
      select *
      from rps.production_transactions
      ${where}
      order by created_at desc
      ${limitClause}
    `,
    queryParams
  );
  if (!trxResult.rows.length) return [];
  const ids = trxResult.rows.map((row) => row.id);
  const consResult = await client.query(
    `
      select mc.id, mc.transaction_id, mc.material_code, mc.planning_qty::float, mc.unit,
             mcb.batch, mcb.quantity::float
      from rps.material_consumptions mc
      left join rps.material_consumption_batches mcb on mcb.material_consumption_id = mc.id
      where mc.transaction_id = any($1)
      order by mc.transaction_id, mc.material_code, mcb.batch
    `,
    [ids]
  );
  const byTransaction = {};
  for (const row of consResult.rows) {
    byTransaction[row.transaction_id] = byTransaction[row.transaction_id] || {};
    const bucket = byTransaction[row.transaction_id];
    bucket[row.material_code] = bucket[row.material_code] || {
      materialCode: row.material_code,
      planningQty: row.planning_qty,
      unit: row.unit,
      batches: []
    };
    if (row.batch) bucket[row.material_code].batches.push({ batch: row.batch, quantity: row.quantity });
  }
  return trxResult.rows.map((row) => toTransaction(row, Object.values(byTransaction[row.id] || {})));
}

const addFilter = (filters, params, sql, value) => {
  params.push(value);
  filters.push(sql.replaceAll("?", `$${params.length}`));
};

const buildTransactionFilter = (queryParams) => {
  const filters = [];
  const params = [];
  if (queryParams.status) addFilter(filters, params, "status = ?", queryParams.status);
  if (queryParams.productionLineCode) addFilter(filters, params, "production_line_code = ?", queryParams.productionLineCode);
  if (queryParams.jumboRollCode) addFilter(filters, params, "jumbo_roll_code = ?", queryParams.jumboRollCode);
  if (queryParams.gradeCode) addFilter(filters, params, "grade_code = ?", queryParams.gradeCode);
  if (queryParams.rawMaterialCode) {
    addFilter(
      filters,
      params,
      "exists (select 1 from rps.material_consumptions mc where mc.transaction_id = rps.production_transactions.id and mc.material_code = ?)",
      queryParams.rawMaterialCode
    );
  }
  if (queryParams.dateFrom) addFilter(filters, params, "production_date_time::date >= ?::date", queryParams.dateFrom);
  if (queryParams.dateTo) addFilter(filters, params, "production_date_time::date <= ?::date", queryParams.dateTo);
  if (queryParams.search) {
    addFilter(
      filters,
      params,
      `(
        roll_number ilike ? or jumbo_batch_number ilike ? or coalesce(pro_number, '') ilike ? or
        production_line_code ilike ? or resource_code ilike ? or shift_code ilike ? or
        jumbo_roll_code ilike ? or bom_code ilike ? or grade_code ilike ? or status ilike ? or
        actual_length_m::text ilike ? or actual_width_mm::text ilike ? or actual_weight_kg::text ilike ? or
        exists (
          select 1 from rps.jumbo_roll_types jt
          where jt.code = rps.production_transactions.jumbo_roll_code
            and (jt.type ilike ? or jt.description ilike ?)
        ) or
        exists (
          select 1
          from rps.material_consumptions mc
          left join rps.material_consumption_batches mcb on mcb.material_consumption_id = mc.id
          where mc.transaction_id = rps.production_transactions.id
            and (mc.material_code ilike ? or coalesce(mcb.batch, '') ilike ?)
        )
      )`,
      `%${queryParams.search}%`
    );
  }
  return { where: filters.length ? `where ${filters.join(" and ")}` : "", params };
};

async function loadTransactionPage(client, queryParams) {
  const pagination = getPagination(queryParams);
  const { where, params } = buildTransactionFilter(queryParams);
  const countResult = await client.query(`select count(*)::int as total_rows from rps.production_transactions ${where}`, params);
  const totalRows = Number(countResult.rows[0]?.total_rows || 0);
  const transactions = await loadTransactions(client, where, params, pagination);
  return { transactions, pagination: emptyPagination(pagination.page, pagination.pageSize, totalRows) };
}

const buildMovementFilter = (queryParams) => {
  const filters = [];
  const params = [];
  if (queryParams.movementType) addFilter(filters, params, "movement_type = ?", queryParams.movementType);
  if (queryParams.materialCode) addFilter(filters, params, "material_code = ?", queryParams.materialCode);
  if (queryParams.materialBatch) addFilter(filters, params, "material_batch ilike ?", `%${queryParams.materialBatch}%`);
  if (queryParams.rollNumber) addFilter(filters, params, "reference_roll_number ilike ?", `%${queryParams.rollNumber}%`);
  if (queryParams.dateFrom) addFilter(filters, params, "created_at::date >= ?::date", queryParams.dateFrom);
  if (queryParams.dateTo) addFilter(filters, params, "created_at::date <= ?::date", queryParams.dateTo);
  if (queryParams.search) {
    addFilter(
      filters,
      params,
      `(movement_type ilike ? or material_code ilike ? or material_batch ilike ? or
        coalesce(reference_roll_number, '') ilike ? or coalesce(reference_jumbo_batch, '') ilike ?)`,
      `%${queryParams.search}%`
    );
  }
  return { where: filters.length ? `where ${filters.join(" and ")}` : "", params };
};

const buildActivityFilter = (queryParams) => {
  const filters = [];
  const params = [];
  if (queryParams.eventType) addFilter(filters, params, "event_type = ?", queryParams.eventType);
  if (queryParams.status) addFilter(filters, params, "status = ?", queryParams.status);
  if (queryParams.userId) addFilter(filters, params, "user_id = ?", queryParams.userId);
  if (queryParams.entityType) addFilter(filters, params, "entity_type = ?", queryParams.entityType);
  if (queryParams.dateFrom) addFilter(filters, params, "created_at::date >= ?::date", queryParams.dateFrom);
  if (queryParams.dateTo) addFilter(filters, params, "created_at::date <= ?::date", queryParams.dateTo);
  if (queryParams.search) {
    addFilter(
      filters,
      params,
      `(event_type ilike ? or coalesce(user_id, '') ilike ? or coalesce(employee_nik, '') ilike ? or
        coalesce(page, '') ilike ? or action ilike ? or coalesce(entity_id, '') ilike ? or
        coalesce(message, '') ilike ?)`,
      `%${queryParams.search}%`
    );
  }
  return { where: filters.length ? `where ${filters.join(" and ")}` : "", params };
};

const validPerformancePeriods = new Set(["hour", "day", "week", "month", "year"]);

app.get("/api/health", async (_req, res) => {
  try {
    const db = await query("select current_database() as database, current_user as user");
    res.json({ status: "ok", database: "ok", connection: db.rows[0] });
  } catch (error) {
    res.status(500).json({ status: "error", database: "error", message: error.message });
  }
});

app.post("/api/auth/login", async (req, res) => {
  const { username, password } = req.body || {};
  const requestContext = getRequestContext(req);
  if (!username || !password) {
    await safeLogActivity({
      ...requestContext,
      eventType: "LOGIN_FAILED",
      action: "login",
      status: "failed",
      message: "Username dan password wajib diisi.",
      metadata: { username: username || "" }
    });
    res.status(400).json({ message: "Username dan password wajib diisi." });
    return;
  }

  try {
    const result = await query(
      `
        select u.id, u.username, u.role, u.employee_nik, e.name as employee_name, e.status as employee_status
        from rps.users u
        join rps.employees e on e.nik = u.employee_nik
        where u.username = $1 and u.password = $2
        limit 1
      `,
      [username, password]
    );
    const row = result.rows[0];
    if (!row || row.employee_status !== "active") {
      await safeLogActivity({
        ...requestContext,
        eventType: "LOGIN_FAILED",
        action: "login",
        status: "failed",
        message: "Login gagal. User harus terdaftar dan employee aktif.",
        metadata: { username }
      });
      res.status(401).json({ message: "Login gagal. User harus terdaftar dan employee aktif." });
      return;
    }
    await safeLogActivity({
      ...requestContext,
      eventType: "LOGIN_SUCCESS",
      userId: row.id,
      employeeNik: row.employee_nik,
      role: row.role,
      action: "login",
      status: "success",
      message: `Login berhasil untuk ${row.username}.`,
      metadata: { username: row.username }
    });
    res.json({
      user: {
        id: row.id,
        username: row.username,
        role: row.role,
        employeeNik: row.employee_nik,
        employeeName: row.employee_name
      }
    });
  } catch (error) {
    await safeLogActivity({
      ...requestContext,
      eventType: "LOGIN_FAILED",
      action: "login",
      status: "failed",
      message: error.message,
      metadata: { username }
    });
    res.status(500).json({ message: error.message });
  }
});

app.get("/api/master/bootstrap", async (_req, res) => {
  try {
    const [
      employees,
      users,
      resources,
      productionLines,
      shifts,
      jumboRollTypes,
      grades,
      rawMaterials,
      rawMaterialBatches,
      boms,
      bomMaterials,
      processOrders
    ] = await Promise.all([
      query("select nik, name, status from rps.employees order by nik"),
      query("select id, username, password, role, employee_nik from rps.users order by id"),
      query("select code, name from rps.resources order by code"),
      query("select code, name, resource_code from rps.production_lines order by code"),
      query("select code, name, to_char(start_time, 'HH24:MI') as start_time, to_char(end_time, 'HH24:MI') as end_time from rps.shifts order by code"),
      query("select code, type, description, status from rps.jumbo_roll_types order by code"),
      query("select code, name, description, status from rps.grades order by code"),
      query("select code, description, unit from rps.raw_materials order by code"),
      query("select batch, material_code, available_qty::float as available_qty, status from rps.raw_material_batches order by batch"),
      query("select bom_code, jumbo_roll_code, version, description, status, is_default from rps.boms order by bom_code"),
      query("select bom_code, material_code, planning_qty::float as planning_qty, unit from rps.bom_materials order by bom_code, material_code"),
      query("select pro_number, status, jumbo_roll_code, planned_good_qty::float as planned_good_qty, planned_unit, planned_start_date::text, planned_end_date::text, default_bom_code, production_line_code from rps.process_orders order by pro_number")
    ]);

    const materialsByBom = bomMaterials.rows.reduce((acc, row) => {
      acc[row.bom_code] = acc[row.bom_code] || [];
      acc[row.bom_code].push({
        materialCode: row.material_code,
        planningQty: row.planning_qty,
        unit: row.unit
      });
      return acc;
    }, {});

    res.json({
      employees: mapRows(employees.rows, (row) => ({ nik: row.nik, name: row.name, status: row.status })),
      users: mapRows(users.rows, (row) => ({
        id: row.id,
        username: row.username,
        password: row.password,
        role: row.role,
        employeeNik: row.employee_nik
      })),
      resources: mapRows(resources.rows, (row) => ({ code: row.code, name: row.name })),
      productionLines: mapRows(productionLines.rows, (row) => ({
        code: row.code,
        name: row.name,
        resourceCode: row.resource_code
      })),
      shifts: mapRows(shifts.rows, (row) => ({
        code: row.code,
        name: row.name,
        startTime: row.start_time,
        endTime: row.end_time
      })),
      jumboRollTypes: mapRows(jumboRollTypes.rows, (row) => ({
        code: row.code,
        type: row.type,
        description: row.description,
        status: row.status
      })),
      grades: mapRows(grades.rows, (row) => ({
        code: row.code,
        name: row.name,
        description: row.description,
        status: row.status
      })),
      rawMaterials: mapRows(rawMaterials.rows, (row) => ({
        code: row.code,
        description: row.description,
        unit: row.unit
      })),
      rawMaterialBatches: mapRows(rawMaterialBatches.rows, (row) => ({
        batch: row.batch,
        materialCode: row.material_code,
        availableQty: row.available_qty,
        status: row.status
      })),
      boms: mapRows(boms.rows, (row) => ({
        bomCode: row.bom_code,
        jumboRollCode: row.jumbo_roll_code,
        version: row.version,
        description: row.description,
        status: row.status,
        isDefault: row.is_default,
        materials: materialsByBom[row.bom_code] || []
      })),
      processOrders: mapRows(processOrders.rows, (row) => ({
        proNumber: row.pro_number,
        status: row.status,
        jumboRollCode: row.jumbo_roll_code,
        plannedGoodQty: row.planned_good_qty,
        plannedUnit: row.planned_unit,
        plannedStartDate: row.planned_start_date,
        plannedEndDate: row.planned_end_date,
        defaultBomCode: row.default_bom_code,
        productionLineCode: row.production_line_code
      }))
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get("/api/transactions", async (_req, res) => {
  try {
    const result = await loadTransactionPage({ query }, _req.query);
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get("/api/reports/jumbo-rolls", async (req, res) => {
  try {
    const result = await loadTransactionPage({ query }, req.query);
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get("/api/reports/raw-material-movements", async (req, res) => {
  try {
    const pagination = getPagination(req.query);
    const { where, params } = buildMovementFilter(req.query);
    const countResult = await query(`select count(*)::int as total_rows from rps.stock_movements ${where}`, params);
    const totalRows = Number(countResult.rows[0]?.total_rows || 0);
    const result = await query(`
      select id, movement_type, transaction_id, material_code, material_batch, quantity::float,
             unit, before_qty::float, after_qty::float, reference_roll_number,
             reference_jumbo_batch, created_at, created_by_user_id
      from rps.stock_movements
      ${where}
      order by created_at desc
      limit $${params.length + 1} offset $${params.length + 2}
    `, [...params, pagination.pageSize, pagination.offset]);
    res.json({
      pagination: emptyPagination(pagination.page, pagination.pageSize, totalRows),
      movements: result.rows.map((row) => ({
        id: row.id,
        movementType: row.movement_type,
        transactionId: row.transaction_id,
        materialCode: row.material_code,
        materialBatch: row.material_batch,
        quantity: row.quantity,
        unit: row.unit,
        beforeQty: row.before_qty,
        afterQty: row.after_qty,
        referenceRollNumber: row.reference_roll_number,
        referenceJumboBatch: row.reference_jumbo_batch,
        createdAt: row.created_at,
        createdByUserId: row.created_by_user_id
      }))
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get("/api/dashboard/production-performance", async (req, res) => {
  try {
    const period = validPerformancePeriods.has(req.query.period) ? req.query.period : "month";
    const year = parsePositiveInt(req.query.year, new Date().getFullYear(), 9999);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || "") ? req.query.date : new Date().toISOString().slice(0, 10);
    const month = /^\d{4}-\d{2}$/.test(req.query.month || "") ? req.query.month : `${year}-${pad(new Date().getMonth() + 1, 2)}`;
    let sql = "";
    let params = [];

    if (period === "hour") {
      params = [date];
      sql = `
        with series as (
          select generate_series($1::date, $1::date + interval '23 hours', interval '1 hour') as bucket
        ),
        buckets as (
          select date_trunc('hour', production_date_time) as bucket,
                 count(*) filter (where status = 'completed')::int as completed,
                 count(*) filter (where status = 'voided')::int as voided,
                 count(*)::int as total
          from rps.production_transactions
          where production_date_time >= $1::date
            and production_date_time < $1::date + interval '1 day'
          group by 1
        )
        select to_char(series.bucket, 'HH24:00') as label,
               series.bucket,
               coalesce(buckets.completed, 0)::int as completed,
               coalesce(buckets.voided, 0)::int as voided,
               (coalesce(buckets.completed, 0) - coalesce(buckets.voided, 0))::int as net,
               coalesce(buckets.total, 0)::int as total
        from series
        left join buckets on buckets.bucket = series.bucket
        order by series.bucket
      `;
    } else if (period === "day") {
      params = [month];
      sql = `
        with bounds as (
          select ($1 || '-01')::date as start_date,
                 (($1 || '-01')::date + interval '1 month - 1 day')::date as end_date
        ),
        series as (
          select generate_series(bounds.start_date, bounds.end_date, interval '1 day') as bucket
          from bounds
        ),
        buckets as (
          select date_trunc('day', production_date_time) as bucket,
                 count(*) filter (where status = 'completed')::int as completed,
                 count(*) filter (where status = 'voided')::int as voided,
                 count(*)::int as total
          from rps.production_transactions, bounds
          where production_date_time >= bounds.start_date
            and production_date_time < bounds.end_date + interval '1 day'
          group by 1
        )
        select to_char(series.bucket, 'DD Mon') as label,
               series.bucket,
               coalesce(buckets.completed, 0)::int as completed,
               coalesce(buckets.voided, 0)::int as voided,
               (coalesce(buckets.completed, 0) - coalesce(buckets.voided, 0))::int as net,
               coalesce(buckets.total, 0)::int as total
        from series
        left join buckets on buckets.bucket = series.bucket
        order by series.bucket
      `;
    } else if (period === "week") {
      params = [year];
      sql = `
        with series as (
          select generate_series(date_trunc('week', make_date($1, 1, 1)), date_trunc('week', make_date($1, 12, 31)), interval '1 week') as bucket
        ),
        buckets as (
          select date_trunc('week', production_date_time) as bucket,
                 count(*) filter (where status = 'completed')::int as completed,
                 count(*) filter (where status = 'voided')::int as voided,
                 count(*)::int as total
          from rps.production_transactions
          where extract(year from production_date_time) = $1
          group by 1
        )
        select to_char(series.bucket, 'IYYY-"W"IW') as label,
               series.bucket,
               coalesce(buckets.completed, 0)::int as completed,
               coalesce(buckets.voided, 0)::int as voided,
               (coalesce(buckets.completed, 0) - coalesce(buckets.voided, 0))::int as net,
               coalesce(buckets.total, 0)::int as total
        from series
        left join buckets on buckets.bucket = series.bucket
        order by series.bucket
      `;
    } else if (period === "month") {
      params = [year];
      sql = `
        with series as (
          select generate_series(make_date($1, 1, 1), make_date($1, 12, 1), interval '1 month') as bucket
        ),
        buckets as (
          select date_trunc('month', production_date_time) as bucket,
                 count(*) filter (where status = 'completed')::int as completed,
                 count(*) filter (where status = 'voided')::int as voided,
                 count(*)::int as total
          from rps.production_transactions
          where extract(year from production_date_time) = $1
          group by 1
        )
        select to_char(series.bucket, 'Mon') as label,
               series.bucket,
               coalesce(buckets.completed, 0)::int as completed,
               coalesce(buckets.voided, 0)::int as voided,
               (coalesce(buckets.completed, 0) - coalesce(buckets.voided, 0))::int as net,
               coalesce(buckets.total, 0)::int as total
        from series
        left join buckets on buckets.bucket = series.bucket
        order by series.bucket
      `;
    } else {
      sql = `
        with bounds as (
          select coalesce(min(extract(year from production_date_time)::int), extract(year from now())::int) as min_year,
                 coalesce(max(extract(year from production_date_time)::int), extract(year from now())::int) as max_year
          from rps.production_transactions
        ),
        series as (
          select generate_series(bounds.min_year, bounds.max_year) as year_bucket
          from bounds
        ),
        buckets as (
          select extract(year from production_date_time)::int as year_bucket,
                 count(*) filter (where status = 'completed')::int as completed,
                 count(*) filter (where status = 'voided')::int as voided,
                 count(*)::int as total
          from rps.production_transactions
          group by 1
        )
        select series.year_bucket::text as label,
               make_date(series.year_bucket, 1, 1) as bucket,
               coalesce(buckets.completed, 0)::int as completed,
               coalesce(buckets.voided, 0)::int as voided,
               (coalesce(buckets.completed, 0) - coalesce(buckets.voided, 0))::int as net,
               coalesce(buckets.total, 0)::int as total
        from series
        left join buckets on buckets.year_bucket = series.year_bucket
        order by series.year_bucket
      `;
    }

    const result = await query(sql, params);
    const totals = result.rows.reduce(
      (acc, row) => ({
        completed: acc.completed + Number(row.completed),
        voided: acc.voided + Number(row.voided),
        net: acc.net + Number(row.net),
        total: acc.total + Number(row.total)
      }),
      { completed: 0, voided: 0, net: 0, total: 0 }
    );
    res.json({
      period,
      year,
      date,
      month,
      totals,
      series: result.rows.map((row) => ({
        label: row.label,
        bucket: row.bucket,
        completed: Number(row.completed),
        voided: Number(row.voided),
        net: Number(row.net),
        total: Number(row.total)
      }))
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get("/api/dashboard/summary", async (_req, res) => {
  try {
    const [transactions, movements, pros] = await Promise.all([
      query(`
        select
          count(*) filter (where status = 'completed')::int as completed,
          count(*) filter (where status = 'voided')::int as voided,
          count(*) filter (
            where status = 'completed'
              and production_date_time::date = current_date
          )::int as todays_roll
        from rps.production_transactions
      `),
      query("select count(*)::int as stock_movements from rps.stock_movements"),
      query("select count(*)::int as active_pro from rps.process_orders where status in ('released', 'in_progress')")
    ]);
    res.json({
      completed: Number(transactions.rows[0]?.completed || 0),
      voided: Number(transactions.rows[0]?.voided || 0),
      todaysRoll: Number(transactions.rows[0]?.todays_roll || 0),
      stockMovements: Number(movements.rows[0]?.stock_movements || 0),
      activePros: Number(pros.rows[0]?.active_pro || 0)
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.post("/api/activity-logs", async (req, res) => {
  const body = req.body || {};
  try {
    if (!body.eventType || !body.action || !body.status) {
      res.status(400).json({ message: "eventType, action, dan status wajib diisi." });
      return;
    }
    await safeLogActivity({
      ...getRequestContext(req),
      eventType: body.eventType,
      userId: body.userId,
      employeeNik: body.employeeNik,
      role: body.role,
      page: body.page,
      action: body.action,
      entityType: body.entityType,
      entityId: body.entityId,
      status: body.status,
      message: body.message,
      metadata: body.metadata || {}
    });
    res.status(201).json({ status: "ok" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get("/api/activity-logs", async (req, res) => {
  try {
    const pagination = getPagination(req.query);
    const { where, params } = buildActivityFilter(req.query);
    const countResult = await query(`select count(*)::int as total_rows from rps.activity_logs ${where}`, params);
    const totalRows = Number(countResult.rows[0]?.total_rows || 0);
    const result = await query(
      `
        select id, event_type, user_id, employee_nik, role, page, action,
               entity_type, entity_id, status, message, metadata_json,
               ip_address, user_agent, created_at
        from rps.activity_logs
        ${where}
        order by created_at desc
        limit $${params.length + 1} offset $${params.length + 2}
      `,
      [...params, pagination.pageSize, pagination.offset]
    );
    res.json({
      pagination: emptyPagination(pagination.page, pagination.pageSize, totalRows),
      logs: result.rows.map(toActivityLog)
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.post("/api/executions/jumbo-roll", async (req, res) => {
  const client = await require("./db.cjs").pool.connect();
  const requestContext = getRequestContext(req);
  try {
    const body = req.body || {};
    const errors = [];
    const required = [
      "productionLineCode",
      "shiftCode",
      "jumboRollCode",
      "bomCode",
      "productionDateTime",
      "actualLengthM",
      "actualWidthMm",
      "actualWeightKg",
      "gradeCode",
      "confirmedEmployeeNik",
      "createdByUserId"
    ];
    for (const field of required) if (!body[field]) errors.push(`${field} wajib diisi.`);
    if (!Array.isArray(body.rawMaterialConsumptions) || !body.rawMaterialConsumptions.length) {
      errors.push("rawMaterialConsumptions wajib diisi.");
    }
    if (errors.length) {
      await safeLogActivity({
        ...requestContext,
        eventType: "EXECUTE_TRANSACTION_FAILED",
        userId: body.createdByUserId,
        page: "execution",
        action: "execute_jumbo_roll",
        entityType: "production_transaction",
        status: "failed",
        message: "Validation failed",
        metadata: { errors, jumboRollCode: body.jumboRollCode, bomCode: body.bomCode }
      });
      res.status(400).json({ message: "Validation failed", errors });
      return;
    }

    await client.query("BEGIN");
    const [line, shift, jumbo, bom, grade, confirmator, user] = await Promise.all([
      client.query("select * from rps.production_lines where code = $1", [body.productionLineCode]),
      client.query("select * from rps.shifts where code = $1", [body.shiftCode]),
      client.query("select * from rps.jumbo_roll_types where code = $1 and status = 'active'", [body.jumboRollCode]),
      client.query("select * from rps.boms where bom_code = $1 and jumbo_roll_code = $2 and status = 'active'", [body.bomCode, body.jumboRollCode]),
      client.query("select * from rps.grades where code = $1 and status = 'active'", [body.gradeCode]),
      client.query("select * from rps.employees where nik = $1 and status = 'active'", [body.confirmedEmployeeNik]),
      client.query("select * from rps.users where id = $1", [body.createdByUserId])
    ]);
    if (!line.rowCount) errors.push("Production line tidak valid.");
    if (!shift.rowCount) errors.push("Shift tidak valid.");
    if (!jumbo.rowCount) errors.push("Jumbo roll tidak aktif/valid.");
    if (!bom.rowCount) errors.push("BOM tidak aktif/valid.");
    if (!grade.rowCount) errors.push("Grade tidak aktif/valid.");
    if (!confirmator.rowCount) errors.push("NIK confirmator tidak aktif/valid.");
    if (!user.rowCount) errors.push("User pembuat transaksi tidak valid.");

    const bomMaterials = await client.query(
      "select material_code, planning_qty::float, unit from rps.bom_materials where bom_code = $1",
      [body.bomCode]
    );
    const bomMap = new Map(bomMaterials.rows.map((row) => [row.material_code, row]));
    for (const bomMaterial of bomMaterials.rows) {
      const consumption = body.rawMaterialConsumptions.find((item) => item.materialCode === bomMaterial.material_code);
      if (!consumption) {
        errors.push(`${bomMaterial.material_code}: consumption belum diisi.`);
        continue;
      }
      const totalActual = consumption.batches.reduce((sum, batch) => sum + Number(batch.quantity || 0), 0);
      const min = Number(bomMaterial.planning_qty) * 0.95;
      const max = Number(bomMaterial.planning_qty) * 1.1;
      if (totalActual < min || totalActual > max) {
        errors.push(`${bomMaterial.material_code}: total aktual harus antara ${min.toFixed(2)} - ${max.toFixed(2)} KG.`);
      }
    }
    for (const consumption of body.rawMaterialConsumptions) {
      if (!bomMap.has(consumption.materialCode)) errors.push(`${consumption.materialCode}: material tidak ada di BOM.`);
      for (const input of consumption.batches || []) {
        const batchResult = await client.query(
          "select * from rps.raw_material_batches where batch = $1 for update",
          [input.batch]
        );
        const batch = batchResult.rows[0];
        if (!batch) {
          errors.push(`${consumption.materialCode}: batch ${input.batch} tidak ditemukan.`);
          continue;
        }
        if (batch.status !== "available") errors.push(`${input.batch}: batch tidak available.`);
        if (batch.material_code !== consumption.materialCode) errors.push(`${input.batch}: material batch tidak sesuai.`);
        if (Number(input.quantity) <= 0) errors.push(`${input.batch}: quantity harus lebih dari 0.`);
        if (Number(input.quantity) > Number(batch.available_qty)) errors.push(`${input.batch}: quantity melebihi stok.`);
      }
    }
    if (errors.length) {
      await client.query("ROLLBACK");
      await safeLogActivity({
        ...requestContext,
        eventType: "EXECUTE_TRANSACTION_FAILED",
        userId: body.createdByUserId,
        employeeNik: user.rows[0]?.employee_nik,
        role: user.rows[0]?.role,
        page: "execution",
        action: "execute_jumbo_roll",
        entityType: "production_transaction",
        status: "failed",
        message: "Validation failed",
        metadata: { errors, jumboRollCode: body.jumboRollCode, bomCode: body.bomCode }
      });
      res.status(400).json({ message: "Validation failed", errors });
      return;
    }

    const monthYearCode = getMonthYearCode(body.productionDateTime);
    const prefix = `${body.productionLineCode} ${body.jumboRollCode} ${monthYearCode}`;
    const runningResult = await client.query(
      "select roll_number from rps.production_transactions where roll_number like $1",
      [`${prefix}%`]
    );
    const maxRunning = runningResult.rows.reduce((max, row) => {
      const last = Number(String(row.roll_number).split(" ").pop());
      return Number.isFinite(last) ? Math.max(max, last) : max;
    }, 0);
    const rollNumber = `${prefix} ${body.gradeCode} ${pad(maxRunning + 1, 3)}`;
    const batchResult = await client.query(
      "select coalesce(max(jumbo_batch_number::bigint), 0) + 1 as next_batch from rps.production_transactions"
    );
    const jumboBatchNumber = pad(batchResult.rows[0].next_batch, 10);
    const transactionId = `TRX-${Date.now()}`;
    const now = new Date().toISOString();

    await client.query(
      `
        insert into rps.production_transactions (
          id, status, output_status, roll_number, jumbo_batch_number, pro_number,
          production_line_code, resource_code, shift_code, operator_user_id,
          operator_employee_nik, jumbo_roll_code, bom_code, production_date_time,
          created_at, created_by_user_id, confirmed_employee_nik, actual_length_m,
          actual_width_mm, actual_weight_kg, grade_code, good_qty, reject_qty,
          output_unit, notes, revision, replacement_of_transaction_id, replacement_of_roll_number
        )
        values ($1,'completed','GOOD',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$8,$14,$15,$16,$17,$18,1,0,'ROLL',$19,1,$20,$21)
      `,
      [
        transactionId,
        rollNumber,
        jumboBatchNumber,
        body.proNumber || null,
        body.productionLineCode,
        line.rows[0].resource_code,
        body.shiftCode,
        body.createdByUserId,
        user.rows[0].employee_nik,
        body.jumboRollCode,
        body.bomCode,
        body.productionDateTime,
        now,
        body.confirmedEmployeeNik,
        body.actualLengthM,
        body.actualWidthMm,
        body.actualWeightKg,
        body.gradeCode,
        body.notes || null,
        body.replacementOfTransactionId || null,
        body.replacementOfRollNumber || null
      ]
    );

    let movementIndex = 1;
    for (const consumption of body.rawMaterialConsumptions) {
      const bomMaterial = bomMap.get(consumption.materialCode);
      const mc = await client.query(
        "insert into rps.material_consumptions (transaction_id, material_code, planning_qty, unit) values ($1,$2,$3,'KG') returning id",
        [transactionId, consumption.materialCode, bomMaterial.planning_qty]
      );
      for (const input of consumption.batches) {
        const batch = await client.query("select available_qty::float from rps.raw_material_batches where batch = $1 for update", [input.batch]);
        const beforeQty = Number(batch.rows[0].available_qty);
        const afterQty = Number((beforeQty - Number(input.quantity)).toFixed(3));
        await client.query(
          "insert into rps.material_consumption_batches (material_consumption_id, batch, quantity) values ($1,$2,$3)",
          [mc.rows[0].id, input.batch, input.quantity]
        );
        await client.query("update rps.raw_material_batches set available_qty = $1 where batch = $2", [afterQty, input.batch]);
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
            `MOV-${Date.now()}-${movementIndex++}`,
            transactionId,
            consumption.materialCode,
            input.batch,
            -Number(input.quantity),
            beforeQty,
            afterQty,
            rollNumber,
            jumboBatchNumber,
            now,
            body.createdByUserId
          ]
        );
      }
    }

    if (body.replacementOfTransactionId) {
      await client.query(
        "update rps.production_transactions set replaced_by_transaction_id = $1, replaced_by_roll_number = $2 where id = $3",
        [transactionId, rollNumber, body.replacementOfTransactionId]
      );
    }

    await safeLogActivity(
      {
        ...requestContext,
        eventType: "EXECUTE_TRANSACTION_SUCCESS",
        userId: body.createdByUserId,
        employeeNik: user.rows[0].employee_nik,
        role: user.rows[0].role,
        page: "execution",
        action: "execute_jumbo_roll",
        entityType: "production_transaction",
        entityId: transactionId,
        status: "success",
        message: `Created roll ${rollNumber}.`,
        metadata: {
          rollNumber,
          jumboBatchNumber,
          jumboRollCode: body.jumboRollCode,
          bomCode: body.bomCode,
          productionLineCode: body.productionLineCode,
          shiftCode: body.shiftCode
        }
      },
      client
    );

    await client.query("COMMIT");
    const transactions = await loadTransactions(client, "where id = $1", [transactionId]);
    res.status(201).json({ transaction: transactions[0] });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    await safeLogActivity({
      ...requestContext,
      eventType: "EXECUTE_TRANSACTION_FAILED",
      userId: req.body?.createdByUserId,
      page: "execution",
      action: "execute_jumbo_roll",
      entityType: "production_transaction",
      status: "failed",
      message: error.message,
      metadata: { jumboRollCode: req.body?.jumboRollCode, bomCode: req.body?.bomCode }
    });
    res.status(500).json({ message: error.message });
  } finally {
    client.release();
  }
});

app.patch("/api/transactions/:id/correction", async (req, res) => {
  const client = await require("./db.cjs").pool.connect();
  const requestContext = getRequestContext(req);
  try {
    const id = req.params.id;
    const body = req.body || {};
    const errors = [];
    if (!body.reason) errors.push("reason wajib diisi.");
    if (!body.approvedEmployeeNik) errors.push("approvedEmployeeNik wajib diisi.");

    await client.query("BEGIN");
    const trxResult = await client.query("select * from rps.production_transactions where id = $1 for update", [id]);
    const current = trxResult.rows[0];
    if (!current) errors.push("Transaksi tidak ditemukan.");
    if (current && current.status !== "completed") errors.push("Hanya transaksi completed yang bisa dikoreksi.");

    const approver = await client.query("select * from rps.employees where nik = $1 and status = 'active'", [body.approvedEmployeeNik]);
    if (!approver.rowCount) errors.push("NIK approval tidak aktif/valid.");
    if (body.shiftCode) {
      const shift = await client.query("select code from rps.shifts where code = $1", [body.shiftCode]);
      if (!shift.rowCount) errors.push("Shift tidak valid.");
    }
    if (body.gradeCode) {
      const grade = await client.query("select code from rps.grades where code = $1 and status = 'active'", [body.gradeCode]);
      if (!grade.rowCount) errors.push("Grade tidak aktif/valid.");
    }
    if (body.proNumber) {
      const pro = await client.query("select pro_number from rps.process_orders where pro_number = $1", [body.proNumber]);
      if (!pro.rowCount) errors.push("PRO tidak valid.");
    }
    if (errors.length) {
      await client.query("ROLLBACK");
      await safeLogActivity({
        ...requestContext,
        eventType: "CORRECT_TRANSACTION_FAILED",
        userId: body.correctedByUserId,
        employeeNik: body.approvedEmployeeNik,
        page: "transactions",
        action: "correct_transaction",
        entityType: "production_transaction",
        entityId: id,
        status: "failed",
        message: "Validation failed",
        metadata: { errors }
      });
      res.status(400).json({ message: "Validation failed", errors });
      return;
    }

    const beforeData = {
      productionDateTime: current.production_date_time,
      shiftCode: current.shift_code,
      actualLengthM: Number(current.actual_length_m),
      actualWidthMm: Number(current.actual_width_mm),
      actualWeightKg: Number(current.actual_weight_kg),
      gradeCode: current.grade_code,
      proNumber: current.pro_number,
      notes: current.notes
    };
    const afterData = {
      productionDateTime: body.productionDateTime || current.production_date_time,
      shiftCode: body.shiftCode || current.shift_code,
      actualLengthM: body.actualLengthM ?? Number(current.actual_length_m),
      actualWidthMm: body.actualWidthMm ?? Number(current.actual_width_mm),
      actualWeightKg: body.actualWeightKg ?? Number(current.actual_weight_kg),
      gradeCode: body.gradeCode || current.grade_code,
      proNumber: body.proNumber || current.pro_number,
      notes: body.notes ?? current.notes
    };

    await client.query(
      `
        update rps.production_transactions
        set production_date_time = $1,
            shift_code = $2,
            actual_length_m = $3,
            actual_width_mm = $4,
            actual_weight_kg = $5,
            grade_code = $6,
            pro_number = $7,
            notes = $8,
            revision = revision + 1
        where id = $9
      `,
      [
        afterData.productionDateTime,
        afterData.shiftCode,
        afterData.actualLengthM,
        afterData.actualWidthMm,
        afterData.actualWeightKg,
        afterData.gradeCode,
        afterData.proNumber || null,
        afterData.notes || null,
        id
      ]
    );
    await client.query(
      `
        insert into rps.correction_histories (
          transaction_id, corrected_at, corrected_by_user_id, approved_employee_nik,
          reason, before_data, after_data
        )
        values ($1, $2, $3, $4, $5, $6, $7)
      `,
      [
        id,
        new Date().toISOString(),
        body.correctedByUserId || current.created_by_user_id,
        body.approvedEmployeeNik,
        body.reason,
        JSON.stringify(beforeData),
        JSON.stringify(afterData)
      ]
    );
    await safeLogActivity(
      {
        ...requestContext,
        eventType: "CORRECT_TRANSACTION_SUCCESS",
        userId: body.correctedByUserId || current.created_by_user_id,
        employeeNik: body.approvedEmployeeNik,
        page: "transactions",
        action: "correct_transaction",
        entityType: "production_transaction",
        entityId: id,
        status: "success",
        message: `Corrected roll ${current.roll_number}.`,
        metadata: { rollNumber: current.roll_number, reason: body.reason, before: beforeData, after: afterData }
      },
      client
    );
    await client.query("COMMIT");
    const transactions = await loadTransactions(client, "where id = $1", [id]);
    res.json({ transaction: transactions[0] });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    await safeLogActivity({
      ...requestContext,
      eventType: "CORRECT_TRANSACTION_FAILED",
      userId: req.body?.correctedByUserId,
      employeeNik: req.body?.approvedEmployeeNik,
      page: "transactions",
      action: "correct_transaction",
      entityType: "production_transaction",
      entityId: req.params.id,
      status: "failed",
      message: error.message
    });
    res.status(500).json({ message: error.message });
  } finally {
    client.release();
  }
});

app.post("/api/transactions/:id/void", async (req, res) => {
  const client = await require("./db.cjs").pool.connect();
  const requestContext = getRequestContext(req);
  try {
    const id = req.params.id;
    const body = req.body || {};
    const errors = [];
    if (!body.reason) errors.push("reason wajib diisi.");
    if (!body.approvedEmployeeNik) errors.push("approvedEmployeeNik wajib diisi.");

    await client.query("BEGIN");
    const trxResult = await client.query("select * from rps.production_transactions where id = $1 for update", [id]);
    const trx = trxResult.rows[0];
    if (!trx) errors.push("Transaksi tidak ditemukan.");
    if (trx && trx.status !== "completed") errors.push("Hanya transaksi completed yang bisa di-void.");
    const approver = await client.query("select * from rps.employees where nik = $1 and status = 'active'", [body.approvedEmployeeNik]);
    if (!approver.rowCount) errors.push("NIK approval void tidak aktif/valid.");
    if (errors.length) {
      await client.query("ROLLBACK");
      await safeLogActivity({
        ...requestContext,
        eventType: "VOID_TRANSACTION_FAILED",
        userId: body.voidedByUserId,
        employeeNik: body.approvedEmployeeNik,
        page: "transactions",
        action: "void_transaction",
        entityType: "production_transaction",
        entityId: id,
        status: "failed",
        message: "Validation failed",
        metadata: { errors }
      });
      res.status(400).json({ message: "Validation failed", errors });
      return;
    }

    const batches = await client.query(
      `
        select mc.material_code, mcb.batch, mcb.quantity::float
        from rps.material_consumptions mc
        join rps.material_consumption_batches mcb on mcb.material_consumption_id = mc.id
        where mc.transaction_id = $1
        order by mc.material_code, mcb.batch
      `,
      [id]
    );
    const now = new Date().toISOString();
    let movementIndex = 1;
    for (const row of batches.rows) {
      const batch = await client.query("select available_qty::float from rps.raw_material_batches where batch = $1 for update", [row.batch]);
      const beforeQty = Number(batch.rows[0].available_qty);
      const afterQty = Number((beforeQty + Number(row.quantity)).toFixed(3));
      await client.query("update rps.raw_material_batches set available_qty = $1 where batch = $2", [afterQty, row.batch]);
      await client.query(
        `
          insert into rps.stock_movements (
            id, movement_type, transaction_id, material_code, material_batch, quantity,
            unit, before_qty, after_qty, reference_roll_number, reference_jumbo_batch,
            created_at, created_by_user_id
          )
          values ($1,'void_reversal',$2,$3,$4,$5,'KG',$6,$7,$8,$9,$10,$11)
        `,
        [
          `MOV-VOID-${Date.now()}-${movementIndex++}`,
          id,
          row.material_code,
          row.batch,
          Number(row.quantity),
          beforeQty,
          afterQty,
          trx.roll_number,
          trx.jumbo_batch_number,
          now,
          body.voidedByUserId || trx.created_by_user_id
        ]
      );
    }
    await client.query(
      `
        update rps.production_transactions
        set status = 'voided',
            void_reason = $1,
            voided_at = $2,
            voided_by_user_id = $3,
            void_approved_employee_nik = $4
        where id = $5
      `,
      [body.reason, now, body.voidedByUserId || trx.created_by_user_id, body.approvedEmployeeNik, id]
    );
    await safeLogActivity(
      {
        ...requestContext,
        eventType: "VOID_TRANSACTION_SUCCESS",
        userId: body.voidedByUserId || trx.created_by_user_id,
        employeeNik: body.approvedEmployeeNik,
        page: "transactions",
        action: "void_transaction",
        entityType: "production_transaction",
        entityId: id,
        status: "success",
        message: `Voided roll ${trx.roll_number}.`,
        metadata: { rollNumber: trx.roll_number, jumboBatchNumber: trx.jumbo_batch_number, reason: body.reason }
      },
      client
    );
    await client.query("COMMIT");
    const transactions = await loadTransactions(client, "where id = $1", [id]);
    res.json({ transaction: transactions[0] });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    await safeLogActivity({
      ...requestContext,
      eventType: "VOID_TRANSACTION_FAILED",
      userId: req.body?.voidedByUserId,
      employeeNik: req.body?.approvedEmployeeNik,
      page: "transactions",
      action: "void_transaction",
      entityType: "production_transaction",
      entityId: req.params.id,
      status: "failed",
      message: error.message
    });
    res.status(500).json({ message: error.message });
  } finally {
    client.release();
  }
});

app.listen(port, () => {
  console.log(`Roll Production System API listening on http://localhost:${port}`);
});
