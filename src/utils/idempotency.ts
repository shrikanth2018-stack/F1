/** Cross-platform UUID v4 generator for idempotency keys sent to payment
 *  Edge Functions. Uses `crypto.randomUUID` when available (modern RN runtimes),
 *  falls back to a Math.random construction so it also works in Expo Go and
 *  older Android builds where `crypto.randomUUID` is absent. */
export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof (crypto as any).randomUUID === 'function') {
    return (crypto as any).randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
