// Realistic mix at a fixed number of concurrent users (closed model): each virtual user is one person — a guest, an account
// holder, a factory, an applicant, staff of either initiative, or the platform administration — who signs in once and moves
// from screen to screen with a few seconds of reading time in between. perf/run.mjs runs it at several levels (step test).
//   k6 run -e VUS=200 -e DURATION=3m -e NAME=mixed-200 perf/k6/mixed.js
import { TREND_STATS, ipFor, summaryHandler, think } from './lib.js';
import { EPS, personaOf } from './personas.js';

const VUS = Number(__ENV.VUS || 100);
const DURATION = __ENV.DURATION || '3m';

const thresholds = {
  http_req_failed: ['rate<0.01'],
  unexpected_status: ['rate<0.01'],
  http_req_duration: ['p(95)<500', 'p(99)<1500'],
};
for (const ep of EPS) thresholds[`http_req_duration{ep:${ep}}`] = ['p(95)<60000']; // per-endpoint rows in the summary

export const options = {
  scenarios: { mix: { executor: 'constant-vus', vus: VUS, duration: DURATION, gracefulStop: '30s' } },
  thresholds,
  summaryTrendStats: TREND_STATS,
  discardResponseBodies: false,
};

const session = { ip: null, token: null, email: null, at: 0 };

export default function () {
  if (!session.ip) {
    session.ip = ipFor(__VU);
    think(0, 4); // users do not all arrive in the same second
  }
  personaOf(__VU)(session, __VU);
  think(2, 6);
}

export const handleSummary = summaryHandler(__ENV.NAME || `mixed-${VUS}`);
