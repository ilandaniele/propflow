import { BUDGETS, SUMMARY_STATS } from '../lib/config.js';
import { hit, pickEndpoint, verifySession, thinkTime, buildThresholds } from '../lib/client.js';
import { makeSummary } from '../lib/summary.js';

export const options = {
  stages: [
    { duration: '10s', target: 20 },
    { duration: '30s', target: 20 },
    { duration: '10s', target: 0 },
  ],
  thresholds: buildThresholds(BUDGETS.load),
  summaryTrendStats: SUMMARY_STATS,
  tags: { test_type: 'load' },
};

export const setup = verifySession;

export default function () {
  hit(pickEndpoint());
  thinkTime(0.5, 2);
}

export const handleSummary = makeSummary('load');
