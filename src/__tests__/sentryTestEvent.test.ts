/**
 * Tests for the crash-reporting self-check.
 *
 * The whole value of this button is that it TELLS THE TRUTH. A diagnostic
 * that reports "sent" when it sent nothing is worse than not having one — it
 * converts an open question into a wrong answer, and the wrong answer is the
 * reassuring one.
 *
 * So the two inert cases are what matter most here: no DSN, and a dev build
 * where `enabled: !__DEV__` suppresses transmission. Both must return false.
 */

const mockCaptureException = jest.fn();
const mockSetTag = jest.fn();
const mockSetLevel = jest.fn();
const mockSetExtras = jest.fn();

jest.mock('@sentry/react-native', () => ({
  init: jest.fn(),
  setUser: jest.fn(),
  captureException: (...a: unknown[]) => mockCaptureException(...a),
  withScope: (fn: (s: unknown) => void) =>
    fn({ setTag: mockSetTag, setLevel: mockSetLevel, setExtras: mockSetExtras }),
}));

/** Reload the module with a chosen DSN + __DEV__, since both are read at import. */
function load(dsn: string, dev: boolean) {
  let mod: typeof import('@/utils/sentry');
  jest.isolateModules(() => {
    process.env.EXPO_PUBLIC_SENTRY_DSN = dsn;
    (globalThis as { __DEV__?: boolean }).__DEV__ = dev;
    mod = require('@/utils/sentry');
  });
  return mod!;
}

const REAL_DEV = (globalThis as { __DEV__?: boolean }).__DEV__;
const REAL_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;

afterAll(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = REAL_DEV;
  process.env.EXPO_PUBLIC_SENTRY_DSN = REAL_DSN;
});

beforeEach(() => jest.clearAllMocks());

describe('sendSentryTestEvent — it must not claim to have sent anything it did not', () => {
  it('sends, and says so, in a release build with a DSN', () => {
    const { sendSentryTestEvent } = load('https://abc@o1.ingest.sentry.io/2', false);
    expect(sendSentryTestEvent()).toBe(true);
    expect(mockCaptureException).toHaveBeenCalledTimes(1);
    expect((mockCaptureException.mock.calls[0][0] as Error).message).toMatch(/diagnostic/i);
  });

  it('tags the event so it can be told apart from a real incident', () => {
    const { sendSentryTestEvent } = load('https://abc@o1.ingest.sentry.io/2', false);
    sendSentryTestEvent();
    expect(mockSetTag).toHaveBeenCalledWith('diagnostic', 'true');
    expect(mockSetLevel).toHaveBeenCalledWith('info');
  });

  it('reports FALSE and sends nothing in a dev build', () => {
    // enabled: !__DEV__ means Sentry transmits nothing here. Returning true
    // would send the tester hunting through Sentry for an event that was
    // never going to arrive.
    const { sendSentryTestEvent } = load('https://abc@o1.ingest.sentry.io/2', true);
    expect(sendSentryTestEvent()).toBe(false);
    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  it('reports FALSE and sends nothing when no DSN is configured', () => {
    const { sendSentryTestEvent } = load('', false);
    expect(sendSentryTestEvent()).toBe(false);
    expect(mockCaptureException).not.toHaveBeenCalled();
  });
});
