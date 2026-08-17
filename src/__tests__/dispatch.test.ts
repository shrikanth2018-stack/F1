import * as fs from 'fs';
import * as path from 'path';
/**
 * Tests for the server-authoritative dispatch logic
 * (supabase/functions/_shared/dispatch.ts) — the IST clock + A/B/C scenario
 * derivation, and the place-order drift comparison.
 *
 * These functions are pure (the clock is injected), so they unit-test cleanly
 * here even though they run inside the Deno edge functions in production.
 */

import {
  timeToMinutes,
  resolveClock,
  getDispatchScenario,
  scenarioToDate,
  isCrossMidnightCycle,
  isCutoffPassedFor,
  toPaise,
  cmpDispatch,
  driftedFields,
} from '../../supabase/functions/_shared/dispatch';

describe('timeToMinutes', () => {
  it('parses HH:MM and HH:MM:SS', () => {
    expect(timeToMinutes('14:30')).toBe(870);
    expect(timeToMinutes('22:30:00')).toBe(1350);
    expect(timeToMinutes('00:00:00')).toBe(0);
  });
});

describe('resolveClock — IST anchoring', () => {
  it('resolves a UTC instant into IST date + minutes', () => {
    // 04:28 UTC → 09:58 IST
    const c = resolveClock(new Date('2026-05-17T04:28:00Z'));
    expect(c.todayStr).toBe('2026-05-17');
    expect(c.tomorrowStr).toBe('2026-05-18');
    expect(c.dayAfterStr).toBe('2026-05-19');
    expect(c.nowMinutes).toBe(9 * 60 + 58);
  });

  it('rolls the IST date over correctly near midnight', () => {
    // 18:45 UTC → 00:15 IST the NEXT calendar day
    const c = resolveClock(new Date('2026-05-17T18:45:00Z'));
    expect(c.todayStr).toBe('2026-05-18');
    expect(c.tomorrowStr).toBe('2026-05-19');
    expect(c.nowMinutes).toBe(15);
  });
});

describe('getDispatchScenario', () => {
  const sameDay = { cutoff_time: '11:00:00', delivery_start: '13:00:00' };
  const crossMidnight = { cutoff_time: '22:30:00', delivery_start: '07:30:00' };

  it('same-day cycle: A before cutoff, B after', () => {
    expect(getDispatchScenario(sameDay, 10 * 60)).toBe('A');   // 10:00
    expect(getDispatchScenario(sameDay, 11 * 60 + 30)).toBe('B'); // 11:30
    expect(getDispatchScenario(sameDay, 11 * 60)).toBe('B');   // exactly cutoff = after
  });

  it('cross-midnight cycle: B before cutoff, C after', () => {
    expect(getDispatchScenario(crossMidnight, 20 * 60)).toBe('B'); // 20:00
    expect(getDispatchScenario(crossMidnight, 23 * 60)).toBe('C'); // 23:00
    expect(getDispatchScenario(crossMidnight, 6 * 60)).toBe('B');  // 06:00 — before tonight's cutoff
  });
});

describe('scenarioToDate', () => {
  const clock = { todayStr: '2026-05-17', tomorrowStr: '2026-05-18', dayAfterStr: '2026-05-19', nowMinutes: 600 };
  it('maps each scenario to its IST date', () => {
    expect(scenarioToDate('A', clock)).toBe('2026-05-17');
    expect(scenarioToDate('B', clock)).toBe('2026-05-18');
    expect(scenarioToDate('C', clock)).toBe('2026-05-19');
  });
});

describe('toPaise', () => {
  it('converts rupees to integer paise, rounding', () => {
    expect(toPaise(100)).toBe(10000);
    expect(toPaise(100.1)).toBe(10010);
    expect(toPaise(99.999)).toBe(10000);
    expect(toPaise(0)).toBe(0);
  });
});

describe('cmpDispatch', () => {
  it('orders by cycle_id then date, nulls last', () => {
    const rows = [
      { cycle_id: null, dispatch_date: '2026-05-17' },
      { cycle_id: 2, dispatch_date: '2026-05-17' },
      { cycle_id: 1, dispatch_date: '2026-05-18' },
      { cycle_id: 1, dispatch_date: '2026-05-17' },
    ];
    const sorted = [...rows].sort(cmpDispatch).map((r) => `${r.cycle_id}:${r.dispatch_date}`);
    expect(sorted).toEqual([
      '1:2026-05-17', '1:2026-05-18', '2:2026-05-17', 'null:2026-05-17',
    ]);
  });
  /**
   * ONE CART MAKES THIS A TOTAL ORDER, NOT A NICETY.
   *
   * Food and essentials share delivery cycles, so after the merge two groups
   * legitimately carry the same (cycle_id, dispatch_date). driftedFields
   * sorts the server's fresh tuple and the client's echo and compares them
   * element by element — with only two keys, two tied entries could pair up
   * against each other's totals and refuse a perfectly good order with a 409
   * the customer cannot clear by retrying.
   */
  it('breaks a cycle+date tie on paise, so the order is total', () => {
    const tied = [
      { cycle_id: 2, dispatch_date: '2026-05-17', group_total_paise: 5250 },
      { cycle_id: 2, dispatch_date: '2026-05-17', group_total_paise: 2625 },
    ];
    // Whichever order they arrive in, they sort the same way.
    const a = [...tied].sort(cmpDispatch).map((r) => r.group_total_paise);
    const b = [...tied].reverse().sort(cmpDispatch).map((r) => r.group_total_paise);
    expect(a).toEqual([2625, 5250]);
    expect(b).toEqual([2625, 5250]);
  });

  it('does not report drift when the client echoes tied groups in the other order', () => {
    const server = {
      total_paise: 7875,
      dispatches: [
        { cycle_id: 2, dispatch_date: '2026-05-17', group_total_paise: 5250 },
        { cycle_id: 2, dispatch_date: '2026-05-17', group_total_paise: 2625 },
      ],
    };
    const echo = {
      total_paise: 7875,
      dispatches: [...server.dispatches].reverse(),
    };
    expect(driftedFields(server, echo)).toEqual([]);
  });
});

describe('driftedFields — the drift path', () => {
  const fresh = {
    total_paise: 25000,
    dispatches: [
      { cycle_id: 1, dispatch_date: '2026-05-17', group_total_paise: 10000 },
      { cycle_id: 2, dispatch_date: '2026-05-18', group_total_paise: 15000 },
    ],
  };

  it('no drift when the echoed quote matches exactly', () => {
    expect(driftedFields(fresh, { ...fresh })).toEqual([]);
  });

  it('no drift when dispatches are echoed in a different order', () => {
    const echo = { total_paise: 25000, dispatches: [...fresh.dispatches].reverse() };
    expect(driftedFields(fresh, echo)).toEqual([]);
  });

  it('flags total drift (price changed)', () => {
    expect(driftedFields(fresh, { total_paise: 25500, dispatches: fresh.dispatches }))
      .toEqual(['total']);
  });

  it('flags dispatch drift when a date shifted (cutoff passed)', () => {
    const echo = {
      total_paise: 25000,
      dispatches: [
        { cycle_id: 1, dispatch_date: '2026-05-16', group_total_paise: 10000 },
        { cycle_id: 2, dispatch_date: '2026-05-18', group_total_paise: 15000 },
      ],
    };
    expect(driftedFields(fresh, echo)).toEqual(['dispatches']);
  });

  it('flags dispatch drift when a group total shifted', () => {
    const echo = {
      total_paise: 25000,
      dispatches: [
        { cycle_id: 1, dispatch_date: '2026-05-17', group_total_paise: 9000 },
        { cycle_id: 2, dispatch_date: '2026-05-18', group_total_paise: 16000 },
      ],
    };
    expect(driftedFields(fresh, echo)).toEqual(['dispatches']);
  });

  it('flags both when a missing echo is supplied', () => {
    expect(driftedFields(fresh, {}).sort()).toEqual(['dispatches', 'total']);
  });

  it('flags dispatch drift when group count differs', () => {
    const echo = { total_paise: 25000, dispatches: [fresh.dispatches[0]] };
    expect(driftedFields(fresh, echo)).toEqual(['dispatches']);
  });
});


// ── The cancellation gate, extracted from cancel-order on 2026-08-17 ──────

describe('isCrossMidnightCycle', () => {
  it('answers for each real cycle', () => {
    // The four live cycles, as Postgres returns them.
    expect(isCrossMidnightCycle({ cutoff_time: '22:30:00', delivery_start: '07:30:00' })).toBe(true);  // Breakfast
    expect(isCrossMidnightCycle({ cutoff_time: '11:00:00', delivery_start: '12:30:00' })).toBe(false); // Lunch
    expect(isCrossMidnightCycle({ cutoff_time: '15:00:00', delivery_start: '16:30:00' })).toBe(false); // Snacks
    expect(isCrossMidnightCycle({ cutoff_time: '18:00:00', delivery_start: '19:30:00' })).toBe(false); // Dinner
  });

  it('is arithmetic, not string order — mixed HH:MM and HH:MM:SS agree', () => {
    // This is the reason the rule moved here. A string comparison of
    // '9:30' > '10:00' is TRUE (because '9' > '1'), and an unpadded hour is
    // exactly the shape a hand-written config value takes.
    expect(isCrossMidnightCycle({ cutoff_time: '9:30', delivery_start: '10:00' })).toBe(false);
    expect('9:30' > '10:00').toBe(true); // the old comparison, wrong here
    expect(isCrossMidnightCycle({ cutoff_time: '22:30', delivery_start: '07:30:00' })).toBe(true);
  });

  it('treats an equal cutoff and delivery time as same-day', () => {
    expect(isCrossMidnightCycle({ cutoff_time: '07:30:00', delivery_start: '07:30' })).toBe(false);
  });

  it('treats a missing delivery_start as same-day, as cancel-order always did', () => {
    expect(isCrossMidnightCycle({ cutoff_time: '11:00:00', delivery_start: null })).toBe(false);
  });
});

describe('isCutoffPassedFor — may this order still be cancelled?', () => {
  const clock = resolveClock(new Date('2026-05-17T09:00:00Z')); // 14:30 IST
  const lunch = { cutoff_time: '11:00:00', delivery_start: '12:30:00' };
  const dinner = { cutoff_time: '18:00:00', delivery_start: '19:30:00' };
  const breakfast = { cutoff_time: '22:30:00', delivery_start: '07:30:00' };

  it("blocks a same-day cycle whose cutoff has passed for TODAY's run", () => {
    // 14:30 IST is past lunch's 11:00 cutoff, and this order goes out today.
    expect(isCutoffPassedFor(lunch, clock.todayStr, clock)).toBe(true);
  });

  it('leaves a later run alone even though the clock is past the cutoff', () => {
    // Same cycle, same time — but tomorrow's lunch has not been locked yet.
    expect(isCutoffPassedFor(lunch, clock.tomorrowStr, clock)).toBe(false);
    expect(isCutoffPassedFor(lunch, clock.dayAfterStr, clock)).toBe(false);
  });

  it('does not block before the cutoff', () => {
    expect(isCutoffPassedFor(dinner, clock.todayStr, clock)).toBe(false); // 14:30 < 18:00
  });

  it('blocks a cross-midnight cycle against TOMORROW, not today', () => {
    // At 23:00 IST, tonight's 22:30 cutoff has locked TOMORROW's breakfast.
    const late = resolveClock(new Date('2026-05-17T17:30:00Z')); // 23:00 IST
    expect(isCutoffPassedFor(breakfast, late.tomorrowStr, late)).toBe(true);
    expect(isCutoffPassedFor(breakfast, late.todayStr, late)).toBe(false);
  });

  it('treats the cutoff minute itself as passed', () => {
    const atCutoff = resolveClock(new Date('2026-05-17T05:30:00Z')); // 11:00 IST exactly
    expect(isCutoffPassedFor(lunch, atCutoff.todayStr, atCutoff)).toBe(true);
  });
});

describe('isCutoffPassedFor is exactly what cancel-order used to compute', () => {
  /**
   * The logic cancel-order carried until 2026-08-17, transcribed verbatim —
   * its own IST clock and its cross-midnight test as a STRING comparison.
   *
   * Kept here as the proof that moving the rule into dispatch.ts changed no
   * behaviour. If the two ever disagree on a real cycle, this fails and the
   * refactor was not a refactor.
   */
  const oldCancelOrderLogic = (
    cycle: { cutoff_time: string; delivery_start: string | null },
    dispatchDate: string,
    todayStr: string,
    tomorrowStr: string,
    nowMins: number,
  ): boolean => {
    const [cutH, cutM] = cycle.cutoff_time.split(':').map(Number);
    const cutoffMins = cutH * 60 + cutM;
    const cutoffPassed = nowMins >= cutoffMins;
    const isCrossMidnight = cycle.delivery_start
      ? cycle.cutoff_time > cycle.delivery_start
      : false;
    const blockedSameDay = !isCrossMidnight && dispatchDate === todayStr && cutoffPassed;
    const blockedCross = isCrossMidnight && dispatchDate === tomorrowStr && cutoffPassed;
    return blockedSameDay || blockedCross;
  };

  it('agrees on every combination of the four live cycles, dates and hours', () => {
    const cycles = [
      { cutoff_time: '22:30:00', delivery_start: '07:30:00' }, // Breakfast
      { cutoff_time: '11:00:00', delivery_start: '12:30:00' }, // Lunch
      { cutoff_time: '15:00:00', delivery_start: '16:30:00' }, // Snacks
      { cutoff_time: '18:00:00', delivery_start: '19:30:00' }, // Dinner
      { cutoff_time: '11:00:00', delivery_start: null },       // the tolerated gap
    ];

    let compared = 0;
    // Every half hour of a full IST day, against yesterday / today / tomorrow /
    // the day after — 5 cycles x 48 instants x 4 dates.
    for (let minutes = 0; minutes < 24 * 60; minutes += 30) {
      const utcMs = Date.UTC(2026, 4, 17, 0, 0) + (minutes - 330) * 60_000;
      const clock = resolveClock(new Date(utcMs));
      const dates = ['2026-05-16', clock.todayStr, clock.tomorrowStr, clock.dayAfterStr];

      for (const cycle of cycles) {
        for (const dispatchDate of dates) {
          const nowRule = isCutoffPassedFor(cycle, dispatchDate, clock);
          const oldRule = oldCancelOrderLogic(
            cycle, dispatchDate, clock.todayStr, clock.tomorrowStr, clock.nowMinutes,
          );
          expect({ cycle, dispatchDate, minutes, nowRule }).toEqual({
            cycle, dispatchDate, minutes, nowRule: oldRule,
          });
          compared += 1;
        }
      }
    }
    expect(compared).toBe(5 * 48 * 4);
  });
});


// ── This module is bundled into the APP, so it must stay portable ─────────

describe('_shared/dispatch.ts stays safe for the app to import', () => {
  /**
   * `OrderDetailScreen` imports this module directly, so the cancellation
   * cutoff has ONE definition instead of a server copy and an app copy that
   * have to be kept honest. That is only safe while the file remains portable:
   * no imports to resolve, no Deno-only API, nothing fetched over HTTP.
   *
   * Add `import { x } from 'https://…'` or a `Deno.env.get(...)` here and Metro
   * cannot bundle it — which would surface as a failed EAS build, or worse, a
   * runtime crash on the order screen. This turns that into a red test on the
   * machine of whoever wrote the import.
   *
   * If a future change genuinely needs one of those, the answer is to move the
   * pure rules into `src/utils/` and have the edge functions import THAT — not
   * to relax this test.
   */
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../supabase/functions/_shared/dispatch.ts'),
    'utf8',
  );

  it('has no import statements', () => {
    const imports = source
      .split('\n')
      .filter((l) => /^\s*import\b/.test(l) && !/^\s*import type\b/.test(l));
    expect(imports).toEqual([]);
  });

  it('touches no Deno API and fetches nothing over HTTP', () => {
    expect(source).not.toMatch(/\bDeno\./);
    expect(source).not.toMatch(/from ['"]https?:\/\//);
    expect(source).not.toMatch(/\brequire\s*\(/);
  });
});
