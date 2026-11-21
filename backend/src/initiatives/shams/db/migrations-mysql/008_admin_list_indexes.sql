-- 008_admin_list_indexes — MySQL counterpart of migrations/008 (PERF-1 / PERF-2). Indexes only: no data change.
-- An ascending (createdAt) / (at, id) index is read backwards for ORDER BY createdAt DESC / ORDER BY at DESC, id DESC
-- (InnoDB appends the primary key to a secondary index, so (at DESC) alone yields at DESC, id ASC and cannot serve the sort).
-- Measured before: 33 s per outbox page (154 k rows) and 2.7 s per audit page (163 k rows) on MySQL 8.4.
CREATE INDEX idx_notif_created ON notification_outbox (createdAt);
CREATE INDEX idx_audit_at_id ON audit_logs (at, id);
