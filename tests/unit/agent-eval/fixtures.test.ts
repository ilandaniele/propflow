/**
 * CI-safe check for the eval harness's fixtures (scripts/agent-eval/): schema
 * validity and basic coverage of the master plan's required categories/
 * locales. No DB, no Anthropic — the real conversations only run via
 * `pnpm agent:eval` (AGENT_EVAL=1 + ANTHROPIC_API_KEY), never in CI.
 */

import { describe, it, expect } from 'vitest';
import { FIXTURES } from '../../../scripts/agent-eval/fixtures';
import { EvalFixtureSchema, EVAL_CATEGORIES } from '../../../scripts/agent-eval/schema';

describe('agent eval fixtures', () => {
  it('has at least 30 scripted conversations', () => {
    expect(FIXTURES.length).toBeGreaterThanOrEqual(30);
  });

  it('every fixture validates against EvalFixtureSchema', () => {
    for (const fixture of FIXTURES) {
      const result = EvalFixtureSchema.safeParse(fixture);
      expect(result.success, `${fixture.id}: ${result.success ? '' : result.error.message}`).toBe(true);
    }
  });

  it('every fixture id is unique', () => {
    const ids = FIXTURES.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('covers Spanish from Peru, Colombia and Argentina, plus English', () => {
    const locales = new Set(FIXTURES.map((f) => f.locale));
    expect(locales).toEqual(new Set(['pe', 'co', 'ar', 'en']));
  });

  it('covers every required scenario category from the master plan', () => {
    const covered = new Set(FIXTURES.map((f) => f.category));
    for (const category of EVAL_CATEGORIES) {
      expect(covered.has(category), `no fixture covers category "${category}"`).toBe(true);
    }
  });

  it('has at least one voice-channel fixture with short turns', () => {
    const voiceFixtures = FIXTURES.filter((f) => f.category === 'voice_short_turns');
    expect(voiceFixtures.length).toBeGreaterThan(0);
    for (const f of voiceFixtures) {
      expect(f.channel).toBe('voice');
      for (const turn of f.turns) expect(turn.split(/\s+/).length).toBeLessThanOrEqual(5);
    }
  });

  it('prompt-injection fixtures plant a decoy tenant and expect no leak', () => {
    const injections = FIXTURES.filter((f) => f.category === 'prompt_injection');
    expect(injections.length).toBeGreaterThan(0);
    for (const f of injections) {
      expect(f.seed.decoyTenantName).toBeTruthy();
      expect(f.expect.noTenantDataLeak).toBe(true);
    }
  });

  it('complaint_handoff fixtures expect handoff_to_human to fire', () => {
    const complaints = FIXTURES.filter((f) => f.category === 'complaint_handoff');
    expect(complaints.length).toBeGreaterThan(0);
    for (const f of complaints) expect(f.expect.handoffCalled).toBe(true);
  });

  it('price_on_request fixtures seed a listing with a null price', () => {
    const priceOnRequest = FIXTURES.filter((f) => f.category === 'price_on_request');
    expect(priceOnRequest.length).toBeGreaterThan(0);
    for (const f of priceOnRequest) {
      expect(f.seed.listings.some((l) => l.price === null)).toBe(true);
      expect(f.expect.mustSayPriceOnRequest).toBe(true);
    }
  });

  it('booking fixtures seed an advisor so real slots can be offered', () => {
    const bookingLike = FIXTURES.filter((f) => ['booking', 'reschedule', 'cancel'].includes(f.category));
    expect(bookingLike.length).toBeGreaterThan(0);
    for (const f of bookingLike) expect(f.seed.advisor).toBe(true);
  });
});
