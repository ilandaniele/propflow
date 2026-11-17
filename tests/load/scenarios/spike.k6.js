import { BUDGETS, SUMMARY_STATS } from '../lib/config.js';
import { hit, pickEndpoint, verifySession, thinkTime, buildThresholds } from '../lib/client.js';
import { makeSummary } from '../lib/summary.js';

export const options = {
  stages: [
    { duration: '8s', target: 4 },
    { duration: '2s', target: 100 },
    { duration: '10s', target: 100 },
    { duration: '3s', target: 4 },
    { duration: '10s', target: 4 },
    { duration: '5s', target: 0 },
  ],
  thresholds: buildThresholds(BUDGETS.spike),
  summaryTrendStats: SUMMARY_STATS,
  tags: { test_type: 'spike' },
};

export const setup = verifySession;

export default function () {
  hit(pickEndpoint());
  thinkTime(0.2, 1);
}

export const handleSummary = makeSummary('spike');
