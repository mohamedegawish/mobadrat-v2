// Stress ramp (open model): screens arrive at a rising rate regardless of how fast the server answers, until the latency or
// error budget breaks. Shows the throughput the platform sustains on this machine and where it degrades. Accounts are signed
// in once by setup(); each screen comes from its own client address, so the per-address limit is never the bottleneck.
//   k6 run -e START=20 -e PEAK=400 -e RAMP=6m perf/k6/stress.js
import { DS, TREND_STATS, ipFor, signInMany, summaryHandler, useTokens } from './lib.js';
import { EPS, personaOf, accountsOf } from './personas.js';

const START = Number(__ENV.START || 20);
const PEAK = Number(__ENV.PEAK || 400);
const RAMP = __ENV.RAMP || '6m';

const thresholds = {
  // stop the ramp once the platform is clearly saturated (evaluated after the first minute)
  http_req_duration: [{ threshold: 'p(95)<3000', abortOnFail: true, delayAbortEval: '60s' }],
  http_req_failed: [{ threshold: 'rate<0.05', abortOnFail: true, delayAbortEval: '60s' }],
  dropped_iterations: ['count<1000000'],
};
for (const ep of EPS) thresholds[`http_req_duration{ep:${ep}}`] = ['p(95)<60000'];

export const options = {
  scenarios: {
    ramp: {
      executor: 'ramping-arrival-rate', startRate: START, timeUnit: '1s', preAllocatedVUs: 200, maxVUs: 1500,
      stages: [{ duration: RAMP, target: PEAK }, { duration: '1m', target: PEAK }],
    },
  },
  thresholds,
  summaryTrendStats: TREND_STATS,
  setupTimeout: '300s',
};

export function setup() { return { tokens: signInMany(accountsOf(300)) }; }

const session = { ip: null, token: null, email: null, at: 0 };
let ready = false;

export default function (data) {
  if (!ready) { useTokens(data.tokens); ready = true; }
  session.ip = ipFor(__VU, __ITER);
  const v = __VU % 300; // the same persona and account as the ones setup() signed in
  personaOf(v)(session, v);
}

export const handleSummary = summaryHandler(__ENV.NAME || 'stress');
void DS;
