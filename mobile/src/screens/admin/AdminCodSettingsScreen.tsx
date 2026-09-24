import { useCallback, useMemo, useState } from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect, useNavigation, usePreventRemove } from '@react-navigation/native';
import {
  Button,
  Chip,
  EmptyState,
  ErrorBanner,
  FooterBar,
  Group,
  LargeTitle,
  LoadingView,
  NavBar,
  Screen,
  Toggle,
} from '../../components/ui';
import { Icon } from '../../components/Icon';
import { PressableScale } from '../../components/motion';
import { adminApi, type CodConfigListing, type CodStateConfig } from '../../api/endpoints';
import { ApiError } from '../../api/client';
import { colors, spacing, typography } from '../../theme';
import { formatPaise, paiseToRupeeInput, rupeesToPaise } from '../../utils/money';

type Filter = 'all' | 'configured' | 'disabled';

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'all', label: 'All states' },
  { value: 'configured', label: 'Configured' },
  { value: 'disabled', label: 'COD off' },
];

/** The API's ceiling for any price (validators/common.ts `paise`). */
const MAX_CHARGE_PAISE = 100_000_000;

/** An edit not yet saved. A field is absent when the admin has not touched it. */
interface Draft {
  codEnabled?: boolean;
  /** Rupee text exactly as typed, so "49." survives on the way to "49.50". */
  charge?: string;
}

interface PendingChange {
  state: string;
  codEnabled: boolean;
  codCharge: number;
}

/** Rupees typed → paise, or the reason it cannot be saved. */
function parseCharge(text: string): { paise: number } | { error: string } {
  const trimmed = text.trim();
  if (!trimmed) return { error: 'Enter an amount — 0 for free cash on delivery.' };
  // Digits with at most two decimal places: no sign, so no negative amounts.
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
    return { error: 'Enter an amount in rupees, 0 or more — e.g. 100 or 49.50.' };
  }
  const paise = rupeesToPaise(trimmed);
  if (paise > MAX_CHARGE_PAISE) return { error: 'That amount is too high.' };
  return { paise };
}

function withoutKeys<T>(record: Record<string, T>, keys: string[]): Record<string, T> {
  const next = { ...record };
  for (const key of keys) delete next[key];
  return next;
}

/**
 * PRD 4.4 / 6 — Cash on Delivery, per state. Admin only.
 *
 * Every state is listed, whether or not it has been configured: an unset state
 * shows the store default and says so. That way the screen is a complete
 * picture of what customers are charged rather than a list of exceptions.
 *
 * Edits — the COD switch and the charge — are held as drafts and written only
 * by the Save button. Saving used to happen on blur, and on Android closing the
 * keyboard with Back does not blur the field, so a typed charge could be lost
 * without a word. Leaving with unsaved edits now asks first.
 *
 * The charge is typed in rupees — the same as the product form — and
 * converted to paise for the API.
 */
export function AdminCodSettingsScreen() {
  const navigation = useNavigation();

  const [listing, setListing] = useState<CodConfigListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');

  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [saving, setSaving] = useState(false);
  /** The state whose "Reset to store default" is in flight. */
  const [resetting, setResetting] = useState<string | null>(null);
  /** Per-state reason from the last save, for the rows that did not save. */
  const [failed, setFailed] = useState<Record<string, string>>({});
  /** Outcome of the last save, shown in the footer until the next edit. */
  const [outcome, setOutcome] = useState<{ tone: 'success' | 'error'; message: string } | null>(
    null,
  );

  const load = useCallback(async () => {
    setError(null);
    try {
      setListing(await adminApi.listCodConfig());
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not load COD settings.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const editDraft = (state: string, patch: Draft) => {
    setOutcome(null);
    setFailed((current) => (state in current ? withoutKeys(current, [state]) : current));
    setDrafts((current) => ({ ...current, [state]: { ...current[state], ...patch } }));
  };

  /**
   * Drafts resolved against the saved rows: what Save would write, and which
   * rows hold an amount that cannot be saved. A draft that lands back on the
   * saved values is not a change.
   */
  const { changes, invalid } = useMemo(() => {
    const byState = new Map((listing?.states ?? []).map((entry) => [entry.state, entry]));
    const pending: PendingChange[] = [];
    const problems: Record<string, string> = {};

    for (const [state, draft] of Object.entries(drafts)) {
      const saved = byState.get(state);
      if (!saved) continue;

      const codEnabled = draft.codEnabled ?? saved.codEnabled;
      let codCharge = saved.codCharge;
      // The charge field is hidden while COD is off, so its draft is ignored.
      if (codEnabled && draft.charge !== undefined) {
        const parsed = parseCharge(draft.charge);
        if ('error' in parsed) {
          problems[state] = parsed.error;
          continue;
        }
        codCharge = parsed.paise;
      }

      if (codEnabled !== saved.codEnabled || codCharge !== saved.codCharge) {
        pending.push({ state, codEnabled, codCharge });
      }
    }
    return { changes: pending, invalid: problems };
  }, [drafts, listing]);

  const invalidCount = Object.keys(invalid).length;
  const hasUnsaved = changes.length > 0 || invalidCount > 0;

  /** Writes every pending change. Resolves true when all of them saved. */
  const saveAll = async (): Promise<boolean> => {
    if (changes.length === 0 || invalidCount > 0) return false;
    setSaving(true);
    setOutcome(null);
    setError(null);

    // One at a time: a handful of rows, and it keeps a burst of edits well
    // inside the API's write rate limit.
    const nextFailed: Record<string, string> = {};
    for (const change of changes) {
      try {
        await adminApi.saveCodConfig(change.state, {
          codEnabled: change.codEnabled,
          codCharge: change.codCharge,
        });
      } catch (caught) {
        nextFailed[change.state] =
          caught instanceof ApiError ? caught.message : 'Could not save this state.';
      }
    }

    const savedStates = changes
      .map((change) => change.state)
      .filter((state) => !(state in nextFailed));
    const failedCount = Object.keys(nextFailed).length;

    // Saved rows drop their draft; failed rows keep theirs so nothing typed is lost.
    setDrafts((current) => withoutKeys(current, savedStates));
    setFailed(nextFailed);
    await load();
    setSaving(false);

    setOutcome(
      failedCount === 0
        ? {
            tone: 'success',
            message: `Saved ${savedStates.length} ${savedStates.length === 1 ? 'state' : 'states'}.`,
          }
        : {
            tone: 'error',
            message: `Couldn't save ${failedCount} ${
              failedCount === 1 ? 'state' : 'states'
            } — the change is kept below. Try again.`,
          },
    );
    return failedCount === 0;
  };

  // Back button, swipe and the Android hardware Back all come through here.
  usePreventRemove(hasUnsaved && !saving, ({ data }) => {
    const leave = () => navigation.dispatch(data.action);
    Alert.alert(
      'Unsaved COD changes',
      invalidCount > 0
        ? 'Some amounts could not be saved as typed. Leave and discard your changes?'
        : 'Save your changes before leaving?',
      [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: leave },
        ...(invalidCount === 0
          ? [
              {
                text: 'Save',
                onPress: () => {
                  void saveAll().then((ok) => {
                    if (ok) leave();
                  });
                },
              },
            ]
          : []),
      ],
    );
  });

  const resetToDefault = (entry: CodStateConfig) => {
    Alert.alert(
      `Reset ${entry.state}?`,
      'This state will follow the store default again until it is set explicitly.',
      [
        { text: 'Keep', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: async () => {
            setResetting(entry.state);
            try {
              await adminApi.deleteCodConfig(entry.state);
              // Any unsaved edit to this row is superseded by the reset.
              setDrafts((current) => withoutKeys(current, [entry.state]));
              setFailed((current) => withoutKeys(current, [entry.state]));
              await load();
            } catch (caught) {
              setError(
                caught instanceof ApiError ? caught.message : 'Could not reset this state.',
              );
            } finally {
              setResetting(null);
            }
          },
        },
      ],
    );
  };

  const visible = useMemo(() => {
    const states = listing?.states ?? [];
    const query = search.trim().toLowerCase();
    return states.filter((entry) => {
      if (query && !entry.state.toLowerCase().includes(query)) return false;
      if (filter === 'configured') return entry.configured;
      if (filter === 'disabled') return !entry.codEnabled;
      return true;
    });
  }, [listing, filter, search]);

  if (loading && !listing) return <LoadingView variant="list" />;

  const defaults = listing?.defaults;
  const pendingStates = new Set(changes.map((change) => change.state));

  const footerMessage = saving
    ? { tone: 'muted' as const, text: 'Saving…' }
    : invalidCount > 0
      ? {
          tone: 'error' as const,
          text: `Fix the highlighted ${invalidCount === 1 ? 'amount' : 'amounts'} to save.`,
        }
      : changes.length > 0
        ? {
            tone: 'muted' as const,
            text: `${changes.length} unsaved ${changes.length === 1 ? 'change' : 'changes'}`,
          }
        : outcome
          ? { tone: outcome.tone, text: outcome.message }
          : { tone: 'muted' as const, text: 'No unsaved changes' };

  return (
    <Screen edges={['top']}>
      <NavBar onBack={() => navigation.goBack()} />

      <LargeTitle
        overline="Admin only"
        title="COD settings"
        caption={
          defaults
            ? `States you haven't set follow the store default: ${
                defaults.codEnabled
                  ? `cash on delivery on, ${formatPaise(defaults.codCharge)}`
                  : 'cash on delivery off'
              }.`
            : undefined
        }
      >
        <View style={styles.searchField}>
          <Icon name="search" size={17} color={colors.textPlaceholder} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Find a state"
            placeholderTextColor={colors.textPlaceholder}
            returnKeyType="search"
            autoCorrect={false}
            style={styles.searchInput}
          />
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
          style={styles.chipsRow}
        >
          {FILTERS.map((entry) => (
            <Chip
              key={entry.value}
              label={entry.label}
              active={filter === entry.value}
              onPress={() => setFilter(entry.value)}
            />
          ))}
        </ScrollView>
      </LargeTitle>

      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load();
            }}
            tintColor={colors.primary}
          />
        }
      >
        {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}

        {visible.length === 0 ? (
          <EmptyState
            icon="info"
            title="No states match"
            message="Try a different filter or search."
          />
        ) : (
          <Group>
            {visible.map((entry) => {
              const draft = drafts[entry.state];
              const codEnabled = draft?.codEnabled ?? entry.codEnabled;
              const chargeError = invalid[entry.state];
              const saveError = failed[entry.state];
              const pending = pendingStates.has(entry.state);
              const locked = saving || resetting === entry.state;

              return (
                <View key={entry.state} style={styles.row}>
                  <View style={styles.rowTop}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.state}>{entry.state}</Text>
                      <Text style={styles.meta}>
                        {entry.configured ? 'Set by you' : 'Store default'}
                        {entry.codEnabled ? '' : ' · COD off'}
                        {pending || chargeError ? (
                          <Text style={styles.metaUnsaved}> · Unsaved</Text>
                        ) : null}
                      </Text>
                    </View>
                    <Toggle
                      value={codEnabled}
                      disabled={locked}
                      onValueChange={(next) => editDraft(entry.state, { codEnabled: next })}
                    />
                  </View>

                  {/* The charge is only meaningful while COD is offered, so a
                      disabled state hides the field rather than showing a
                      number that does nothing. */}
                  {codEnabled ? (
                    <View style={styles.chargeRow}>
                      <Text style={styles.chargeLabel}>COD charge</Text>
                      <View style={[styles.chargeField, chargeError ? styles.chargeFieldError : null]}>
                        <Text style={styles.rupee}>₹</Text>
                        <TextInput
                          value={draft?.charge ?? paiseToRupeeInput(entry.codCharge)}
                          onChangeText={(text) => editDraft(entry.state, { charge: text })}
                          keyboardType="decimal-pad"
                          returnKeyType="done"
                          editable={!locked}
                          selectTextOnFocus
                          accessibilityLabel={`COD charge for ${entry.state}, in rupees`}
                          style={styles.chargeInput}
                        />
                      </View>
                    </View>
                  ) : null}

                  {chargeError ? <Text style={styles.rowError}>{chargeError}</Text> : null}
                  {saveError && !chargeError ? (
                    <Text style={styles.rowError}>Not saved: {saveError}</Text>
                  ) : null}

                  {entry.configured ? (
                    <PressableScale
                      onPress={() => resetToDefault(entry)}
                      disabled={locked}
                      hitSlop={8}
                      style={styles.resetWrap}
                    >
                      <Text style={styles.reset}>
                        {resetting === entry.state ? 'Resetting…' : 'Reset to store default'}
                      </Text>
                    </PressableScale>
                  ) : null}
                </View>
              );
            })}
          </Group>
        )}

        <Text style={styles.note}>
          Customers pick their state from a list, and older addresses typed by hand are matched by
          name, including common spellings and state codes. Checkout always prices COD on the
          server — a saved change takes effect on the next order.
        </Text>
      </ScrollView>

      <FooterBar>
        <Text
          style={[
            styles.footerStatus,
            footerMessage.tone === 'success' && styles.footerSuccess,
            footerMessage.tone === 'error' && styles.footerError,
          ]}
          accessibilityLiveRegion="polite"
        >
          {footerMessage.text}
        </Text>
        <Button
          label="Save changes"
          onPress={() => void saveAll()}
          loading={saving}
          disabled={changes.length === 0 || invalidCount > 0}
        />
      </FooterBar>
    </Screen>
  );
}

const styles = StyleSheet.create({
  searchField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
    backgroundColor: colors.fill,
    borderRadius: 12,
    paddingHorizontal: spacing.md + 2,
    marginTop: spacing.lg,
  },
  searchInput: { flex: 1, paddingVertical: spacing.md, fontSize: 16, color: colors.text },

  chipsRow: { flexGrow: 0, marginTop: spacing.md, marginHorizontal: -spacing.xl },
  chips: { paddingHorizontal: spacing.xl, gap: spacing.sm },

  list: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl },

  row: { paddingHorizontal: spacing.lg + 2, paddingVertical: spacing.lg },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  state: { ...typography.bodyStrong, fontWeight: '600', color: colors.text },
  meta: { ...typography.caption, color: colors.textFaint, marginTop: 2 },
  metaUnsaved: { color: colors.primary },

  chargeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginTop: spacing.md,
  },
  chargeLabel: { ...typography.callout, color: colors.textMuted },
  chargeField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: colors.fill,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'transparent',
    paddingHorizontal: spacing.md,
    minWidth: 110,
  },
  chargeFieldError: { borderColor: colors.primary },
  rupee: { ...typography.callout, color: colors.textMuted },
  chargeInput: {
    flex: 1,
    paddingVertical: spacing.sm + 2,
    fontSize: 17,
    color: colors.text,
    textAlign: 'right',
  },
  rowError: { ...typography.footnote, color: colors.primary, marginTop: spacing.sm },

  resetWrap: { alignSelf: 'flex-start', marginTop: spacing.md },
  reset: { ...typography.calloutStrong, color: colors.primary },

  note: {
    ...typography.caption,
    color: colors.textFaint,
    lineHeight: 19,
    marginTop: spacing.lg,
    paddingHorizontal: spacing.xs,
  },

  footerStatus: {
    ...typography.footnote,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  footerSuccess: { color: colors.success },
  footerError: { color: colors.primary },
});
