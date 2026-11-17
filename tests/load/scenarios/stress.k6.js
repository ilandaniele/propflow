import { BUDGETS, SUMMARY_STATS } from '../lib/config.js';
import { hit, pickEndpoint, verifySession, thinkTime, buildThresholds } from '../lib/client.js';
import { makeSummary } from '../lib/summary.js';

export const options = {
  stages: [
    { duration: '10s', target: 50 },
    { duration: '10s', target: 100 },
    { duration: '10s', target: 150 },
    { duration: '15s', target: 200 },
    { duration: '10s', target: 200 },
    { duration: '5s', target: 0 },
  ],
  thresholds: buildThresholds(BUDGETS.stress),
  summaryTrendStats: SUMMARY_STATS,
  tags: { test_type: 'stress' },
};

export const setup = verifySession;

export default function () {
  hit(pickEndpoint());
  thinkTime(0.2, 1);
}

export const handleSummary = makeSummary('stress');
