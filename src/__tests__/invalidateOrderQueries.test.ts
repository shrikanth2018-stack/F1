/**
 * 1stOne F1 — every cache that reads orders must be invalidated when one changes.
 *
 * WHY THIS TEST EXISTS. `invalidateOrderQueries` carries a hand-maintained list
 * of query-key roots, and its own header records that it "has asked to be
 * updated and been ignored six times": the admin Undelivered tab, driver
 * history, hub history and its detail, the vendor order list, and a customer's
 * orders on the admin customer screen were all added without adding their key.
 *
 * The symptom, reported on 13 Aug 2026: an admin cancels an undelivered order
 * and it STAYS on the Undelivered tab. Nothing was wrong on the server. The
 * screen was reading a cache nobody had told about the change. The gate was
 * fully green, because a convention that has to be remembered is not a rule.
 *
 * So this makes it a rule. Add a screen that reads orders under a new query
 * key, forget the list, and this fails by name.
 *
 * ── HOW IT WORKS, AND WHY IT IS BUILT THIS WAY ────────────────────────
 *
 * 1. THE COVERED KEYS ARE OBSERVED, NOT IMPORTED. `invalidateOrderQueries` is
 *    called with a fake QueryClient that records what it was asked to
 *    invalidate. So the test asserts what the function DOES, not what a
 *    constant says — and no production file needed a new export to be testable.
 *
 * 2. THE ORDER-READING QUERIES ARE FOUND BY PARSING, NOT BY GREP. Each query
 *    declaration is located in the TypeScript AST, and its key is paired with
 *    ITS OWN body. That precision is the whole game: five files touch the
 *    orders table only inside a MUTATION (`useBranchMutations` counting orders
 *    before deleting a branch, `useMenuManagement` before removing a menu
 *    item). A file-level grep would flag those and the test would either be
 *    permanently red or grow an allowlist until it meant nothing.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import { invalidateOrderQueries } from '../api/invalidateOrderQueries';
import { QUERY_KEYS } from '../utils/constants';

// ── 1. What does invalidateOrderQueries actually invalidate? ───────────
function observeInvalidatedKeys(): string[][] {
  const seen: string[][] = [];
  const recorder = {
    invalidateQueries: ({ queryKey }: { queryKey: unknown[] }) => {
      seen.push(queryKey.map(String));
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  invalidateOrderQueries(recorder as any);
  return seen;
}

// ── 2. Which query declarations read orders? ───────────────────────────

/** Hooks that declare a cache entry, and where the key lives in the call. */
const KEY_IS_FIRST_ARG = new Set([
  'useSupabaseQuery',
  'useSupabaseInfiniteQuery',
  'useSupabaseSingle',
]);
const KEY_IS_OPTION = new Set(['useQuery', 'useInfiniteQuery']);

/**
 * What counts as reading an order.
 *
 * The RPC names are here because several surfaces never touch the table
 * directly — the customer's own state map, the admin Undelivered tab, the
 * vendor's list and the kitchen board all go through a function. Those are the
 * exact screens that were missed last time.
 */
const ORDER_READ_SIGNALS = [
  "from('orders')",
  'from("orders")',
  "from('order_items')",
  'from("order_items")',
  "'my_order_states'",
  "'admin_undelivered_order_ids'",
  "'vendor_orders'",
  "'get_kitchen_aggregate'",
];

/**
 * Query keys that read orders and are deliberately NOT invalidated, each with
 * the reason. Anything added here is a decision on the record, not a shrug.
 */
const DELIBERATELY_NOT_INVALIDATED: Record<string, string> = {
  feedback_items:
    "The line items of ONE order, read so the customer can rate them. An order's " +
    'lines never change after it is created — verified: nothing in the app or ' +
    'in any SQL file updates or deletes order_items (only the test-data reset ' +
    'does), and `authenticated` has neither the INSERT nor the UPDATE grant. So ' +
    'a status change cannot alter what this query returns, and invalidating it ' +
    'would refetch identical rows.',

  customer_export:
    'The admin customer export. It pages through every profile and joins orders ' +
    'to count them per customer, so it matches the detector honestly — but it ' +
    'is an on-demand report someone opens, reads and leaves, not a live list. ' +
    'Refreshing it on every order status change would re-run an unbounded ' +
    'multi-page export for a screen nobody is looking at, and a count that is ' +
    'a few minutes stale changes no decision made from it.',
};

interface FoundQuery {
  file: string;
  line: number;
  keyRoot: string;
}

/** Resolve `QUERY_KEYS.MY_ORDERS` to its first element ('orders'). */
function resolveQueryKeysMember(expressionText: string): string | null {
  const match = /QUERY_KEYS\.([A-Z_]+)/.exec(expressionText);
  if (!match) return null;
  const value = (QUERY_KEYS as Record<string, readonly string[]>)[match[1]];
  return value && value.length > 0 ? value[0] : null;
}

/** The first element of a query-key array literal, as a string. */
function keyRootOf(node: ts.Node, source: ts.SourceFile): string | null {
  if (!ts.isArrayLiteralExpression(node) || node.elements.length === 0) return null;
  const first = node.elements[0];
  if (ts.isStringLiteral(first)) return first.text;
  // `[...QUERY_KEYS.X, 'sub']` — the root is the constant's own first element.
  if (ts.isSpreadElement(first)) return resolveQueryKeysMember(first.getText(source));
  if (ts.isPropertyAccessExpression(first)) return resolveQueryKeysMember(first.getText(source));
  return null;
}

function collectOrderQueries(files: string[]): FoundQuery[] {
  const found: FoundQuery[] = [];

  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);

    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const callee = ts.isPropertyAccessExpression(node.expression)
          ? node.expression.name.getText(source)
          : node.expression.getText(source);

        let keyNode: ts.Node | undefined;
        if (KEY_IS_FIRST_ARG.has(callee)) {
          keyNode = node.arguments[0];
        } else if (KEY_IS_OPTION.has(callee)) {
          const options = node.arguments[0];
          if (options && ts.isObjectLiteralExpression(options)) {
            const prop = options.properties.find(
              (p) => ts.isPropertyAssignment(p) && p.name.getText(source) === 'queryKey',
            );
            if (prop && ts.isPropertyAssignment(prop)) keyNode = prop.initializer;
          }
        }

        if (keyNode) {
          const root = keyRootOf(keyNode, source);
          // The body of THIS query only — not the file.
          const callText = node.getText(source);
          const readsOrders = ORDER_READ_SIGNALS.some((s) => callText.includes(s));
          if (root && readsOrders) {
            found.push({
              file: path.relative(process.cwd(), file),
              line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
              keyRoot: root,
            });
          }
        }
      }
      ts.forEachChild(node, visit);
    };

    visit(source);
  }

  return found;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue;
      out.push(...walk(full));
    } else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

// ── 3. The assertions ─────────────────────────────────────────────────

describe('invalidateOrderQueries covers every cache that reads orders', () => {
  const root = path.resolve(__dirname, '..');
  const sourceFiles = [
    ...walk(path.join(root, 'hooks')),
    ...walk(path.join(root, 'screens')),
    ...walk(path.join(root, 'api')),
  ];
  const invalidated = observeInvalidatedKeys();
  const orderQueries = collectOrderQueries(sourceFiles);

  /** Is this query key reached by one of the invalidated roots? */
  const isCovered = (keyRoot: string): boolean =>
    invalidated.some((invalidatedKey) => invalidatedKey[0] === keyRoot);

  it('finds the order-reading queries at all (guards the detector itself)', () => {
    // If a refactor renames the query hooks or the supabase builder, this test
    // would silently start finding nothing and pass for ever. These are the
    // surfaces that must always be found.
    expect(orderQueries.length).toBeGreaterThanOrEqual(10);
    const roots = new Set(orderQueries.map((q) => q.keyRoot));
    for (const expected of [
      'orders',                     // customer My Orders, detail, home rail
      'admin_orders_manage',        // admin day list
      'admin_orders_undelivered',   // the tab that surfaced the bug
      'driver_orders',
      'hub_order_history',
      'vendor_orders',
    ]) {
      expect([...roots]).toContain(expected);
    }
  });

  it('invalidates every order-reading query key', () => {
    const uncovered = orderQueries.filter(
      (q) => !isCovered(q.keyRoot) && !(q.keyRoot in DELIBERATELY_NOT_INVALIDATED),
    );

    // Asserted as a STRING, not an array, so the failure output carries the
    // remedy with it. `toEqual` takes one argument — passing a second as a
    // custom message is not typed and does not compile, which tsc caught while
    // this test was being written.
    const report =
      uncovered.length === 0
        ? ''
        : [
            '',
            'These queries read orders but are never invalidated when an order',
            'changes, so the screen showing them keeps stale data until it remounts:',
            '',
            ...uncovered.map((q) => `    '${q.keyRoot}'   ${q.file}:${q.line}`),
            '',
            'Add the key root to ORDER_QUERY_ROOTS in src/api/invalidateOrderQueries.ts.',
            'If it genuinely should NOT refresh, add it to',
            'DELIBERATELY_NOT_INVALIDATED in this test, with the reason.',
            '',
          ].join('\n');

    expect(report).toBe('');
  });

  it('has no invalidation targets that nothing reads any more', () => {
    // The other direction: a key left in the list after its screen was deleted
    // is harmless at runtime but it is a lie about what the app contains, and
    // it makes the list harder to trust. `orders` is the shared prefix for
    // MY_ORDERS / STAFF_ORDERS / ORDERS, so it is always live.
    const readRoots = new Set(orderQueries.map((q) => q.keyRoot));
    const orphans = invalidated
      .map((k) => k[0])
      .filter((rootKey) => rootKey !== 'orders' && !readRoots.has(rootKey));

    expect(orphans).toEqual([]);
  });

  it('documents every deliberate exclusion with a reason', () => {
    for (const [key, reason] of Object.entries(DELIBERATELY_NOT_INVALIDATED)) {
      expect(reason.length).toBeGreaterThan(40);
      // An exclusion for a key nothing declares is stale — it would hide a
      // real omission the day that key came back under a different meaning.
      expect(orderQueries.map((q) => q.keyRoot)).toContain(key);
    }
  });
});
