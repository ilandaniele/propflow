import { BUDGETS, SUMMARY_STATS } from '../lib/config.js';
import { hit, pickEndpoint, verifySession, thinkTime, buildThresholds } from '../lib/client.js';
import { makeSummary } from '../lib/summary.js';

export const options = {
  stages: [
    { duration: '15s', target: 15 },
    { duration: '150s', target: 15 },
    { duration: '15s', target: 0 },
  ],
  thresholds: buildThresholds(BUDGETS.soak),
  summaryTrendStats: SUMMARY_STATS,
  tags: { test_type: 'soak' },
};

export const setup = verifySession;

export default function () {
  hit(pickEndpoint());
  thinkTime(0.5, 2);
}

export const handleSummary = makeSummary('soak');
