/**
 * Tests for the shared Supabase hook layer (src/api/useSupabaseQuery.ts).
 *
 * Locks the four primitives every hook funnels through — array reads,
 * post-processing `transform`, single-row reads, offset pagination, and
 * mutations with onSuccess — so the one chokepoint for error handling
 * stays correct as hooks migrate onto it.
 */

// The shared layer imports supabaseClient (→ native AsyncStorage). These
// tests drive the hooks with their own query/mutation fns, so a stub is
// enough — the real supabase object is never touched.
jest.mock('@/api/supabaseClient', () => ({ supabase: {} }));

import { renderHook, waitFor, act } from '@testing-library/react-native';
import { createWrapper } from './_helpers/queryClient';
import {
  useSupabaseQuery,
  useSupabaseSingle,
  useSupabaseInfiniteQuery,
  useSupabaseMutation,
} from '@/api/useSupabaseQuery';

describe('useSupabaseQuery', () => {
  it('returns rows as an array', async () => {
    const { Wrapper } = createWrapper();
    const { result } = renderHook(
      () => useSupabaseQuery(['t1'], () =>
        Promise.resolve({ data: [{ id: 1 }, { id: 2 }], error: null })),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it('applies transform to the fetched rows', async () => {
    const { Wrapper } = createWrapper();
    const { result } = renderHook(
      () => useSupabaseQuery(
        ['t2'],
        () => Promise.resolve({ data: [{ n: 10 }, { n: 5 }], error: null }),
        { transform: (rows: { n: number }[]) => rows.reduce((s, r) => s + r.n, 0) },
      ),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe(15);
  });

  it('surfaces an error response as isError', async () => {
    const { Wrapper } = createWrapper();
    const { result } = renderHook(
      () => useSupabaseQuery(
        ['t3'],
        () => Promise.resolve({ data: null, error: { message: 'boom' } }),
        { retry: false },
      ),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('boom');
  });
});

describe('useSupabaseSingle', () => {
  it('returns a single object', async () => {
    const { Wrapper } = createWrapper();
    const { result } = renderHook(
      () => useSupabaseSingle(['s1'], () =>
        Promise.resolve({ data: { id: 7 }, error: null })),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ id: 7 });
  });
});

describe('useSupabaseInfiniteQuery', () => {
  it('paginates and stops when a page comes back short', async () => {
    const { Wrapper } = createWrapper();
    const { result } = renderHook(
      () => useSupabaseInfiniteQuery<number>(
        ['inf'],
        (offset) => Promise.resolve({ data: offset === 0 ? [1, 2] : [3], error: null }),
        { pageSize: 2 },
      ),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.hasNextPage).toBe(true); // first page was full

    await act(async () => { await result.current.fetchNextPage(); });
    await waitFor(() => expect(result.current.hasNextPage).toBe(false)); // short page

    expect(result.current.data?.pages).toEqual([[1, 2], [3]]);
  });
});

describe('useSupabaseMutation', () => {
  it('runs the mutation and fires options.onSuccess', async () => {
    const onSuccess = jest.fn();
    const { Wrapper } = createWrapper();
    const { result } = renderHook(
      () => useSupabaseMutation<{ x: number }>(
        (p) => Promise.resolve({ data: { ok: p.x }, error: null }),
        undefined,
        { onSuccess },
      ),
      { wrapper: Wrapper },
    );
    await act(async () => { await result.current.mutateAsync({ x: 42 }); });
    expect(onSuccess).toHaveBeenCalledWith({ ok: 42 }, { x: 42 });
  });

  it('throws and surfaces the error message', async () => {
    const { Wrapper } = createWrapper();
    const { result } = renderHook(
      () => useSupabaseMutation<{ x: number }>(
        () => Promise.resolve({ data: null, error: { message: 'write failed' } }),
      ),
      { wrapper: Wrapper },
    );
    await expect(
      act(async () => { await result.current.mutateAsync({ x: 1 }); }),
    ).rejects.toThrow('write failed');
  });
});
