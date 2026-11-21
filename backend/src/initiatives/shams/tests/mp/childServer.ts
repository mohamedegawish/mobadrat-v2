/**
 * Multi-process test child: one real application server (createApp) in its own Node process, with its own SQLite connection
 * to the SAME database file as the other children. The parent passes DB_PATH / UPLOAD_DIR / REGISTRY_* through the environment
 * and receives the listening port over IPC. No seeding here: the parent seeds the shared file once before spawning.
 */
const { getDb } = await import('../../src/db/sqlite.js');
const { createApp } = await import('../../src/app.js');

getDb(); // opens the shared file (WAL, busy_timeout) — migrations are already applied by the parent, so this is a no-op
const server = createApp().listen(0, '127.0.0.1', () => {
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  process.send?.({ type: 'ready', port, pid: process.pid });
});
process.on('message', (m: unknown) => {
  if (m === 'exit') server.close(() => process.exit(0));
});
process.on('disconnect', () => process.exit(0));
