/**
 * 1stOne F1 — System Health Screen (audit O1)
 *
 * Admin observability surface for background jobs. Shows, for every
 * pg_cron job, its last run + status + 24h failure count; the recent
 * subscription-dispatch manifest runs; and push-delivery outcomes over
 * the last 24h. All from the get_job_health() RPC (useJobHealth).
 *
 * The C1 outage ran invisibly for ~2 days because nothing surfaced
 * background-job state. This is that surface.
 */

import React from 'react';
import { View, ScrollView, StyleSheet, ActivityIndicator, RefreshControl, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { ScreenHeader } from '../../components/ScreenHeader';
import { Divider } from '../../components/Divider';
import { ErrorRetry } from '../../components/ErrorRetry';
import { useJobHealth, type CronJobHealth } from '../../hooks/useJobHealth';
import { sendSentryTestEvent } from '../../utils/sentry';
import { analyticsStatus } from '../../utils/analytics';
import { infoDialog } from '../../utils/confirmDialog';
import { formatRelativeTime, formatDateShort } from '../../utils/formatters';

const B = Theme.typography.sizes.body + 2;
const S = Theme.typography.sizes.small + 2;

type Tone = 'success' | 'warning' | 'error' | 'muted';

const TONE_COLOR: Record<Tone, string> = {
  success: Theme.colors.status.success,
  warning: Theme.colors.status.warning,
  error: Theme.colors.status.error,
  muted: Theme.colors.text.muted,
};

/**
 * A job is red if its last run failed; amber if it recovered but still
 * logged failures inside the 24h window; green when clean.
 */
function jobTone(j: CronJobHealth): Tone {
  if (j.last_status === 'failed') return 'error';
  if (j.last_status === 'succeeded') return j.failures_24h > 0 ? 'warning' : 'success';
  return 'muted';
}

function SectionLabel({ title }: { title: string }) {
  return (
    <ThemedText variant="small" color="muted" style={styles.sectionLabel}>
      {title.toUpperCase()}
    </ThemedText>
  );
}

export function JobHealthScreen() {
  const { data, isLoading, isError, refetch, isRefetching } = useJobHealth();
  // Read once per render — it is env + __DEV__, neither of which changes.
  const analytics = analyticsStatus();

  /**
   * The dialog matters as much as the event. A test that reports "sent" when
   * it sent nothing is worse than no test — so the two inert cases (no DSN, or
   * a dev build where `enabled: !__DEV__` suppresses everything) say so
   * explicitly rather than showing a cheerful tick.
   */
  const handleTestEvent = () => {
    const sent = sendSentryTestEvent({ source: 'JobHealthScreen', at: new Date().toISOString() });
    if (sent) {
      infoDialog(
        'Test event sent',
        'Open Sentry → Issues and look for "1stOne diagnostic". It should appear within a minute.\n\n' +
          'Check the stack trace names a real file, e.g. JobHealthScreen.tsx. If it reads ' +
          'index.android.bundle:1:… then the source maps did not upload for this build.',
      );
    } else {
      infoDialog(
        'Nothing was sent',
        'Crash reporting is switched off in this build — either no Sentry DSN is configured, ' +
          'or this is a development build, where it is disabled on purpose to keep the noise out.\n\n' +
          'Use the release build to test it.',
      );
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScreenHeader title="System Health" />

      {isLoading ? (
        <ActivityIndicator style={{ marginTop: Theme.spacing.xl }} color={Theme.colors.action.primary} />
      ) : isError ? (
        <ErrorRetry message="Could not load job health." onRetry={refetch} />
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: Theme.spacing.xl * 2 }}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={Theme.colors.action.primary} />
          }
        >
          {/* ── Background jobs ── */}
          <SectionLabel title="Background Jobs" />
          <View style={styles.group}>
            {(data?.jobs ?? []).map((j) => {
              const tone = jobTone(j);
              return (
                <View key={j.jobname} style={styles.jobRow}>
                  <View style={[styles.dot, { backgroundColor: TONE_COLOR[tone] }]} />
                  <View style={{ flex: 1 }}>
                    <ThemedText variant="body" color="primary" style={{ fontSize: B }}>
                      {j.jobname}{!j.active ? '  (paused)' : ''}
                    </ThemedText>
                    <ThemedText variant="small" color="muted" style={{ fontSize: S, marginTop: 2 }}>
                      {j.schedule}
                      {j.last_run ? `  ·  last run ${formatRelativeTime(j.last_run)}` : '  ·  never run'}
                    </ThemedText>
                    {tone === 'error' && !!j.last_message && (
                      <ThemedText variant="small" style={[styles.errText, { fontSize: S }]} numberOfLines={2}>
                        {j.last_message}
                      </ThemedText>
                    )}
                  </View>
                  <ThemedText variant="small" style={{ fontSize: S, color: TONE_COLOR[tone] }}>
                    {j.last_status === 'failed'
                      ? 'Failed'
                      : j.failures_24h > 0
                        ? `${j.failures_24h} failed / 24h`
                        : 'OK'}
                  </ThemedText>
                </View>
              );
            })}
          </View>

          <Divider />

          {/* ── Dispatch manifest runs ── */}
          <SectionLabel title="Dispatch Runs" />
          <View style={styles.group}>
            {(data?.manifest ?? []).length === 0 ? (
              <ThemedText variant="small" color="muted" style={styles.emptyNote}>
                No manifest runs logged.
              </ThemedText>
            ) : (
              (data?.manifest ?? []).map((m, i) => (
                <View key={`${m.run_date}-${i}`} style={styles.fieldRow}>
                  <View style={{ flex: 1 }}>
                    <ThemedText variant="body" color="primary" style={{ fontSize: B }}>
                      {formatDateShort(m.run_date)}
                    </ThemedText>
                    {!!m.error_detail && (
                      <ThemedText variant="small" style={[styles.errText, { fontSize: S }]} numberOfLines={2}>
                        {m.error_detail}
                      </ThemedText>
                    )}
                  </View>
                  <ThemedText variant="small" color="muted" style={{ fontSize: S }}>
                    {m.orders_created} created · {m.orders_skipped} skipped
                  </ThemedText>
                </View>
              ))
            )}
          </View>

          <Divider />

          {/* ── Push delivery (24h) ── */}
          <SectionLabel title="Push Delivery · 24h" />
          <View style={styles.group}>
            {Object.keys(data?.push_24h ?? {}).length === 0 ? (
              <ThemedText variant="small" color="muted" style={styles.emptyNote}>
                No pushes sent in the last 24h.
              </ThemedText>
            ) : (
              Object.entries(data?.push_24h ?? {}).map(([status, count]) => (
                <View key={status} style={styles.fieldRow}>
                  <ThemedText variant="body" color="primary" style={{ flex: 1, fontSize: B }}>
                    {status === 'invalid_token' ? 'Invalid token' : status.charAt(0).toUpperCase() + status.slice(1)}
                  </ThemedText>
                  <ThemedText
                    variant="body"
                    style={{
                      fontSize: B,
                      color: status === 'failed'
                        ? Theme.colors.status.error
                        : status === 'sent'
                          ? Theme.colors.status.success
                          : Theme.colors.text.muted,
                    }}
                  >
                    {count}
                  </ThemedText>
                </View>
              ))
            )}
          </View>

          <Divider />

          {/* ── Crash reporting ──
              Every other section on this screen reports what the system DID.
              This one asks a question, because crash reporting is the one
              piece of observability that cannot report on itself: if it is
              broken, its symptom is silence, which is identical to a healthy
              app. The only way to tell them apart is to send something on
              purpose. Ask again after every native build — a binary can ship
              without its source maps and nothing will say so. */}
          <SectionLabel title="Crash Reporting" />
          <View style={styles.group}>
            <TouchableOpacity style={styles.fieldRow} onPress={handleTestEvent} activeOpacity={0.7}>
              <View style={{ flex: 1 }}>
                <ThemedText variant="body" color="primary" style={{ fontSize: B }}>
                  Send a test event
                </ThemedText>
                <ThemedText variant="small" color="muted" style={{ fontSize: S, marginTop: 3 }}>
                  Proves Sentry receives, and that traces name real files
                </ThemedText>
              </View>
              <ThemedText variant="body" color="mint" style={{ fontSize: B }}>Send ›</ThemedText>
            </TouchableOpacity>
          </View>

          <Divider />

          {/* ── Analytics ──
              Not an action, a STATEMENT — and it exists for the same reason as
              the button above. Analytics has been switched off since the day
              it was written, because no key was ever configured, and nothing
              anywhere said so: an app sending no events looks identical to an
              app nobody is using. The host is shown too, because pointing a
              key at the wrong region fails exactly as silently. */}
          <SectionLabel title="Analytics" />
          <View style={styles.group}>
            <View style={styles.fieldRow}>
              <View style={{ flex: 1 }}>
                <ThemedText variant="body" color="primary" style={{ fontSize: B }}>
                  {analytics.enabled ? 'Sending events' : 'Not sending'}
                </ThemedText>
                <ThemedText variant="small" color="muted" style={{ fontSize: S, marginTop: 3 }}>
                  {analytics.reason}
                </ThemedText>
                <ThemedText variant="small" color="muted" style={{ fontSize: S, marginTop: 3 }}>
                  {analytics.host}
                </ThemedText>
              </View>
              <View
                style={[
                  styles.dot,
                  {
                    marginTop: 0,
                    backgroundColor: analytics.enabled
                      ? Theme.colors.status.success
                      : Theme.colors.text.muted,
                  },
                ]}
              />
            </View>
          </View>

          {!!data?.checked_at && (
            <ThemedText variant="small" color="muted" style={styles.checkedAt}>
              Checked {formatRelativeTime(data.checked_at)}
            </ThemedText>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Theme.colors.background.primary },

  sectionLabel: {
    fontSize: S,
    letterSpacing: 1,
    paddingHorizontal: Theme.spacing.md,
    paddingTop: Theme.spacing.md,
    paddingBottom: Theme.spacing.xs,
  },
  group: { paddingHorizontal: Theme.spacing.md },
  jobRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: Theme.spacing.sm + 2,
    gap: Theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  dot: { width: 9, height: 9, borderRadius: 5, marginTop: 5 },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Theme.spacing.sm + 2,
    gap: Theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  errText: { color: Theme.colors.status.error, marginTop: 3 },
  emptyNote: { paddingVertical: Theme.spacing.sm },
  checkedAt: {
    fontSize: S,
    textAlign: 'center',
    paddingTop: Theme.spacing.md,
  },
});
