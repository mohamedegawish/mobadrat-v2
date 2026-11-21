-- 008_admin_list_indexes — PERF-1 / PERF-2 (docs/performance/PERFORMANCE_TEST_REPORT.md). Indexes only: no data change.
--
-- PERF-1 GET /admin/notifications orders the outbox by createdAt DESC. Without an index every page sorted the whole
--        outbox (it keeps every message, with its body). Measured on MySQL 8.4 with 154 k rows: 33 s per page, and the
--        page timed out under load.
-- PERF-2 GET /admin/audit-logs orders by (at DESC, id DESC). idx_audit_at (at DESC) cannot serve the id tie-break, so
--        every page sorted the whole audit log. Measured: 2.7 s per page with 163 k rows.
CREATE INDEX IF NOT EXISTS idx_notif_created ON notification_outbox(createdAt);
CREATE INDEX IF NOT EXISTS idx_audit_at_id ON audit_logs(at, id);
