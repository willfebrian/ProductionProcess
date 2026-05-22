const { query } = require("./db.cjs");

const toActivityLog = (row) => ({
  id: row.id,
  eventType: row.event_type,
  userId: row.user_id || undefined,
  employeeNik: row.employee_nik || undefined,
  role: row.role || undefined,
  page: row.page || undefined,
  action: row.action,
  entityType: row.entity_type || undefined,
  entityId: row.entity_id || undefined,
  status: row.status,
  message: row.message || undefined,
  metadata: row.metadata_json || {},
  ipAddress: row.ip_address || undefined,
  userAgent: row.user_agent || undefined,
  createdAt: row.created_at
});

const getRequestContext = (req) => ({
  ipAddress: req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress || req.ip,
  userAgent: req.headers["user-agent"] || ""
});

async function logActivity(activity, client = null) {
  const executor = client || { query };
  const metadata = activity.metadata ? JSON.stringify(activity.metadata) : "{}";
  const id = `LOG-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  await executor.query(
    `
      insert into rps.activity_logs (
        id, event_type, user_id, employee_nik, role, page, action,
        entity_type, entity_id, status, message, metadata_json,
        ip_address, user_agent, created_at
      )
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15)
    `,
    [
      id,
      activity.eventType,
      activity.userId || null,
      activity.employeeNik || null,
      activity.role || null,
      activity.page || null,
      activity.action,
      activity.entityType || null,
      activity.entityId || null,
      activity.status,
      activity.message || null,
      metadata,
      activity.ipAddress || null,
      activity.userAgent || null,
      activity.createdAt || new Date().toISOString()
    ]
  );
}

async function safeLogActivity(activity, client = null) {
  try {
    await logActivity(activity, client);
  } catch (error) {
    console.warn(`Activity log skipped: ${error.message}`);
  }
}

module.exports = { getRequestContext, logActivity, safeLogActivity, toActivityLog };
