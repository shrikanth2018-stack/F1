/**
 * Tests for the analytics guards.
 *
 * Analytics has been silently off since the day it was written — no key was
 * ever configured, and nothing anywhere said so. An app sending no events
 * looks exactly like an app nobody is using. These pin the two things that
 * stop that repeating:
 *
 *   1. it does not run in a DEV build, so the funnel is not polluted by
 *      whoever is building the app
 *   2. analyticsStatus() reports honestly WHY it is off, so Job Health can
 *      show it instead of the absence being invisible
 *
 * Plus the privacy rule: identify sends the user id, never the phone number.
 */

const mockIdentify = jest.fn();
const mockCapture = jest.fn();
const mockCtor = jest.fn();

jest.mock('posthog-react-native', () => ({
  __esModule: true,
  default: class {
    constructor(...args: unknown[]) { mockCtor(...args); }
    identify = (...a: unknown[]) => mockIdentify(...a);
    capture = (...a: unknown[]) => mockCapture(...a);
    reset = jest.fn();
  },
}));

function load(key: string, dev: boolean, host?: string) {
  let mod: typeof import('@/utils/analytics');
  jest.isolateModules(() => {
    process.env.EXPO_PUBLIC_POSTHOG_KEY = key;
    if (host === undefined) delete process.env.EXPO_PUBLIC_POSTHOG_HOST;
    else process.env.EXPO_PUBLIC_POSTHOG_HOST = host;
    (globalThis as { __DEV__?: boolean }).__DEV__ = dev;
    mod = require('@/utils/analytics');
  });
  return mod!;
}

const REAL_DEV = (globalThis as { __DEV__?: boolean }).__DEV__;
const REAL_KEY = process.env.EXPO_PUBLIC_POSTHOG_KEY;
const REAL_HOST = process.env.EXPO_PUBLIC_POSTHOG_HOST;

afterAll(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = REAL_DEV;
  process.env.EXPO_PUBLIC_POSTHOG_KEY = REAL_KEY;
  process.env.EXPO_PUBLIC_POSTHOG_HOST = REAL_HOST;
});

beforeEach(() => jest.clearAllMocks());

describe('initAnalytics — off unless it is genuinely wanted', () => {
  it('starts in a release build with a key', () => {
    const a = load('phc_test', false);
    a.initAnalytics();
    expect(mockCtor).toHaveBeenCalledWith('phc_test', { host: 'https://eu.i.posthog.com' });
    expect(a.analyticsStatus()).toMatchObject({ enabled: true });
  });

  it('does NOT start in a dev build, so the funnel is not measuring us', () => {
    const a = load('phc_test', true);
    a.initAnalytics();
    expect(mockCtor).not.toHaveBeenCalled();
    expect(a.analyticsStatus()).toMatchObject({ enabled: false });
    expect(a.analyticsStatus().reason).toMatch(/development/i);
  });

  it('does not start with no key, and says that is why', () => {
    const a = load('', false);
    a.initAnalytics();
    expect(mockCtor).not.toHaveBeenCalled();
    expect(a.analyticsStatus().reason).toMatch(/POSTHOG_KEY/);
  });

  it('reports the host, since the wrong region fails silently', () => {
    const a = load('phc_test', false, 'https://us.i.posthog.com');
    a.initAnalytics();
    expect(a.analyticsStatus().host).toBe('https://us.i.posthog.com');
    expect(mockCtor).toHaveBeenCalledWith('phc_test', { host: 'https://us.i.posthog.com' });
  });
});

describe('identifyUser — the id, never the phone number', () => {
  it('sends no properties when none are given', () => {
    const a = load('phc_test', false);
    a.initAnalytics();
    a.identifyUser('user-uuid-1');
    expect(mockIdentify).toHaveBeenCalledWith('user-uuid-1', undefined);
    // The regression guarded against: a phone number reaching a third party
    // for no analytical gain. useAuth passes the id alone.
    const sent = JSON.stringify(mockIdentify.mock.calls[0]);
    expect(sent).not.toMatch(/phone/i);
  });

  it('STRIPS a phone number even if a caller passes one', () => {
    // The rule is enforced in the function, not left to every call site to
    // remember — because the convention already lost once: useAuth passed
    // `{ phone }` for months before anyone noticed.
    const a = load('phc_test', false);
    a.initAnalytics();
    a.identifyUser('user-uuid-1', { phone: '919155555555', plan_type: 'food' });
    const [, props] = mockIdentify.mock.calls[0];
    expect(props).toEqual({ plan_type: 'food' });
    expect(JSON.stringify(props)).not.toMatch(/9191555/);
  });

  it('strips the other direct identifiers too, and keeps the rest', () => {
    const a = load('phc_test', false);
    a.initAnalytics();
    a.identifyUser('u1', {
      email: 'x@y.z', full_name: 'One Customer', address: '1 Test St',
      mobile: '99999', branch_id: 1, is_vendor: false,
    });
    expect(mockIdentify.mock.calls[0][1]).toEqual({ branch_id: 1, is_vendor: false });
  });

  it('stays silent entirely when analytics never started', () => {
    const a = load('', false);
    a.initAnalytics();
    a.identifyUser('user-uuid-1');
    expect(mockIdentify).not.toHaveBeenCalled();
  });
});
