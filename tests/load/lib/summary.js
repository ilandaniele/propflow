import { htmlReport } from 'https://raw.githubusercontent.com/benc-uk/k6-reporter/2.4.0/dist/bundle.js';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.1.0/index.js';

// Writes JSON + HTML to tests/load/results/ (k6 must be run from the propflow root).
export function makeSummary(testName) {
  return function handleSummary(data) {
    return {
      [`tests/load/results/${testName}.json`]: JSON.stringify(data, null, 2),
      [`tests/load/results/${testName}.html`]: htmlReport(data, { title: `propflow ${testName} test` }),
      stdout: textSummary(data, { indent: ' ', enableColors: false }),
    };
  };
}
