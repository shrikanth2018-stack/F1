/**
 * 1stOne F1 — THE Shared Hooks for ALL Supabase Calls
 *
 * MANDATE: no screen or hook writes its own try-catch for Supabase. Every
 * read/write goes through one of these primitives, so error handling, retry,
 * and stale-time live in ONE place — the single chokepoint for query
 * behaviour (telemetry, offline policy, error normalisation all land here).
 *
 *   useSupabaseQuery         — list reads. Optional `transform` post-processes
 *                              the rows (aggregations) without leaving the
 *                              layer; it runs once per fetch (result cached).
 *   useSupabaseSingle        — single-row reads (returns the row or null).
 *   useSupabaseInfiniteQuery — offset-paginated / infinite-scroll reads.
 *   useSupabaseMutation      — writes. Invalidates keys + optional
 *                              onSuccess / onError callbacks.
 *
 * Usage:
 *   useSupabaseQuery(['k'], () => supabase.from('t').select('*'))
 *   useSupabaseQuery(['k'], 't', { select: '*', filter: q => q.eq('a', 1) })
 *   useSupabaseQuery(['k'], () => supabase.from('t').select('*'),
 *                    { transform: rows => aggregate(rows) })
 */

import {
  useQuery,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type UseQueryOptions,
} from '@tanstack/react-query';
import { supabase } from './supabaseClient';

const DEFAULT_STALE_TIME = 1000 * 60 * 2;
const DEFAULT_RETRY = 2;

// The internal fn accepts any Promise-like response — type safety comes from
// the generic T on the hook's return value, not the fn's response type.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseQueryFn<_T> = () => PromiseLike<{ data: any; error: { message: string } | null }>;

interface TableQueryOptions {
  select?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  filter?: (query: any) => any;
}

// ── useSupabaseQuery ─────────────────────────────────────────

// Overload: raw function → T[]
export function useSupabaseQuery<T>(
  queryKey: readonly unknown[],
  queryFn: SupabaseQueryFn<T>,
  options?: Omit<UseQueryOptions<T[], Error>, 'queryKey' | 'queryFn'>
): ReturnType<typeof useQuery<T[], Error>>;

// Overload: raw function + transform → TResult
export function useSupabaseQuery<T, TResult>(
  queryKey: readonly unknown[],
  queryFn: SupabaseQueryFn<T>,
  options: Omit<UseQueryOptions<TResult, Error>, 'queryKey' | 'queryFn'> & {
    transform: (rows: T[]) => TResult;
  }
): ReturnType<typeof useQuery<TResult, Error>>;

// Overload: table shorthand → T[]
export function useSupabaseQuery<T>(
  queryKey: readonly unknown[],
  tableName: string,
  tableOptions: TableQueryOptions,
  options?: Omit<UseQueryOptions<T[], Error>, 'queryKey' | 'queryFn'>
): ReturnType<typeof useQuery<T[], Error>>;

// Overload: table shorthand + transform → TResult
export function useSupabaseQuery<T, TResult>(
  queryKey: readonly unknown[],
  tableName: string,
  tableOptions: TableQueryOptions,
  options: Omit<UseQueryOptions<TResult, Error>, 'queryKey' | 'queryFn'> & {
    transform: (rows: T[]) => TResult;
  }
): ReturnType<typeof useQuery<TResult, Error>>;

// Implementation — deliberately loose; the overloads above are the contract.
export function useSupabaseQuery(
  queryKey: readonly unknown[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fnOrTable: (() => PromiseLike<any>) | string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  optionsOrTableOptions?: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  maybeOptions?: any,
  // Return type is `any` ONLY on this implementation signature — the four
  // typed overloads above are the contract callers actually see. The
  // overloads diverge (T[] vs TResult), so the impl must be the loose union.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let resolvedFn: () => PromiseLike<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let resolvedOptions: any;

  if (typeof fnOrTable === 'string') {
    // Table shorthand
    const tableOpts = (optionsOrTableOptions as TableQueryOptions) ?? {};
    resolvedOptions = maybeOptions;
    resolvedFn = () => {
      // Dynamic table name bypasses the typed from() overloads — safe because
      // callers pass the correct T generic which types the hook's return value.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let query = (supabase as any).from(fnOrTable).select(tableOpts.select ?? '*');
      if (tableOpts.filter) {
        query = tableOpts.filter(query);
      }
      return query;
    };
  } else {
    resolvedFn = fnOrTable;
    resolvedOptions = optionsOrTableOptions;
  }

  // `transform` is consumed here, not forwarded to react-query.
  const { transform, ...rqOptions } = resolvedOptions ?? {};

  return useQuery({
    queryKey: queryKey as unknown[],
    queryFn: async () => {
      const response = await resolvedFn();
      if (response.error) {
        throw new Error(response.error.message);
      }
      const data = response.data;
      const rows = Array.isArray(data) ? data : [data];
      return transform ? transform(rows) : rows;
    },
    staleTime: DEFAULT_STALE_TIME,
    retry: DEFAULT_RETRY,
    ...rqOptions,
  });
}

// ── useSupabaseSingle ────────────────────────────────────────

export function useSupabaseSingle<T>(
  queryKey: readonly unknown[],
  queryFn: SupabaseQueryFn<T>,
  options?: Omit<UseQueryOptions<T | null, Error>, 'queryKey' | 'queryFn'>
) {
  return useQuery<T | null, Error>({
    queryKey: queryKey as unknown[],
    queryFn: async () => {
      const response = await queryFn();
      if (response.error) {
        throw new Error(response.error.message);
      }
      const data = response.data;
      return Array.isArray(data) ? data[0] ?? null : data;
    },
    staleTime: DEFAULT_STALE_TIME,
    retry: DEFAULT_RETRY,
    ...options,
  });
}

// ── useSupabaseInfiniteQuery ─────────────────────────────────

/**
 * Offset-paginated read. `queryFn` receives the running row offset and returns
 * one page of rows; the next page is requested while the last page came back
 * full (length === pageSize).
 */
export function useSupabaseInfiniteQuery<T>(
  queryKey: readonly unknown[],
  // `data` is `any` for the same reason as SupabaseQueryFn — type safety comes
  // from the caller's T generic, which types each page; a Supabase builder's
  // generated row type need not match T exactly.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  queryFn: (offset: number) => PromiseLike<{ data: any; error: { message: string } | null }>,
  options: { pageSize: number; enabled?: boolean },
) {
  return useInfiniteQuery<T[], Error>({
    queryKey: queryKey as unknown[],
    queryFn: async ({ pageParam }) => {
      const response = await queryFn(pageParam as number);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return (response.data ?? []) as T[];
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage: T[], allPages: T[][]) =>
      lastPage.length < options.pageSize
        ? undefined
        : allPages.reduce((sum, page) => sum + page.length, 0),
    enabled: options.enabled,
    staleTime: DEFAULT_STALE_TIME,
    retry: DEFAULT_RETRY,
  });
}

// ── useSupabaseMutation ──────────────────────────────────────

/**
 * Generic mutation hook for Supabase writes. Invalidates `invalidateKeys` on
 * success; `options.onSuccess` / `options.onError` add custom post-logic
 * (optimistic cache writes, extra invalidations, alerts) while error handling
 * still lives in this one place.
 */
export function useSupabaseMutation<TPayload, TResult = unknown>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mutationFn: (payload: TPayload) => PromiseLike<{ data: any; error: { message: string } | null }>,
  invalidateKeys?: ReadonlyArray<readonly unknown[]>,
  options?: {
    onSuccess?: (data: TResult | TResult[] | null, payload: TPayload) => void;
    onError?: (error: Error, payload: TPayload) => void;
  },
) {
  const queryClient = useQueryClient();

  return useMutation<TResult | TResult[] | null, Error, TPayload>({
    mutationFn: async (payload) => {
      const response = await mutationFn(payload);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data;
    },
    onSuccess: (data, payload) => {
      if (invalidateKeys) {
        invalidateKeys.forEach((key) => {
          queryClient.invalidateQueries({ queryKey: key as unknown[] });
        });
      }
      options?.onSuccess?.(data, payload);
    },
    onError: options?.onError,
  });
}
