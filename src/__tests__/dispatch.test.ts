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
