/**
 * 1stOne F1 — THE Shared Hook for ALL Supabase Calls
 *
 * MANDATE: No screen ever writes its own try-catch for Supabase.
 * Wraps TanStack Query with stale-while-revalidate, retry, error handling.
 *
 * Two usage patterns:
 *
 * 1. Raw function:
 *   useSupabaseQuery(['key'], () => supabase.from('t').select('*'))
 *
 * 2. Table shorthand:
 *   useSupabaseQuery(['key'], 'table_name', {
 *     select: '*',
 *     filter: (query) => query.eq('active', true).order('sort_order')
 *   })
 */

import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryOptions,
} from '@tanstack/react-query';
import { supabase } from './supabaseClient';

// The internal fn accepts any Promise-like response — type safety comes from
// the generic T on the hook's return value, not the fn's response type.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseQueryFn<_T> = () => PromiseLike<{ data: any; error: { message: string } | null }>;

interface TableQueryOptions {
  select?: string;
  filter?: (query: any) => any;
}

// Overload: raw function
export function useSupabaseQuery<T>(
  queryKey: readonly unknown[],
  queryFn: SupabaseQueryFn<T>,
  options?: Omit<UseQueryOptions<T[], Error>, 'queryKey' | 'queryFn'>
): ReturnType<typeof useQuery<T[], Error>>;

// Overload: table shorthand
export function useSupabaseQuery<T>(
  queryKey: readonly unknown[],
  tableName: string,
  tableOptions: TableQueryOptions,
  options?: Omit<UseQueryOptions<T[], Error>, 'queryKey' | 'queryFn'>
): ReturnType<typeof useQuery<T[], Error>>;

// Implementation
export function useSupabaseQuery<T>(
  queryKey: readonly unknown[],
  fnOrTable: SupabaseQueryFn<T> | string,
  optionsOrTableOptions?: any,
  maybeOptions?: any,
) {
  let resolvedFn: SupabaseQueryFn<T>;
  let resolvedOptions: Omit<UseQueryOptions<T[], Error>, 'queryKey' | 'queryFn'> | undefined;

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

  return useQuery<T[], Error>({
    queryKey: queryKey as unknown[],
    queryFn: async () => {
      const response = await resolvedFn();
      if (response.error) {
        throw new Error(response.error.message);
      }
      const data = response.data;
      return Array.isArray(data) ? data : [data as T];
    },
    staleTime: 1000 * 60 * 2,
    retry: 2,
    ...resolvedOptions,
  });
}

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
    staleTime: 1000 * 60 * 2,
    retry: 2,
    ...options,
  });
}

/**
 * Generic mutation hook for Supabase write operations.
 * Automatically invalidates related queries on success.
 */
export function useSupabaseMutation<TPayload, TResult = unknown>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mutationFn: (payload: TPayload) => PromiseLike<{ data: any; error: { message: string } | null }>,
  invalidateKeys?: ReadonlyArray<readonly unknown[]>
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
    onSuccess: () => {
      if (invalidateKeys) {
        invalidateKeys.forEach((key) => {
          queryClient.invalidateQueries({ queryKey: key as unknown[] });
        });
      }
    },
  });
}
