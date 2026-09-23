import { useCallback, useMemo, useState } from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import {
  Chip,
  EmptyState,
  ErrorBanner,
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

/**
 * PRD 4.4 / 6 — Cash on Delivery, per state. Admin only.
 *
 * Every state is listed, whether or not it has been configured: an unset state
 * shows the store default and says so, and touching either control writes a
 * rule for it. That way the screen is a complete picture of what customers are
 * charged rather than a list of exceptions with the rest left implicit.
 *
 * The charge is typed in rupees, the only place in the app where money is
 * entered — the same as the product form — and converted to paise for the API.
 */
export function AdminCodSettingsScreen() {
  const navigation = useNavigation();

  const [listing, setListing] = useState<CodConfigListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  /** The state currently being saved, so only its row shows as busy. */
  const [saving, setSaving] = useState<string | null>(null);
  /**
   * Rupee text held per state while it is being edited. A row is only written
   * back on blur, so typing "1" on the way to "150" does not save ₹1.
   */
  const [drafts, setDrafts] = useState<Record<string, string>>({});

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

  const save = async (state: string, next: { codEnabled: boolean; codCharge: number }) => {
    setSaving(state);
    setError(null);
    try {
      await adminApi.saveCodConfig(state, next);
      // Clear the draft so the row goes back to rendering the saved figure.
      setDrafts((current) => {
        const { [state]: _dropped, ...rest } = current;
        return rest;
      });
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not save this state.');
    } finally {
      setSaving(null);
    }
  };

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
            setSaving(entry.state);
            try {
              await adminApi.deleteCodConfig(entry.state);
              await load();
            } catch (caught) {
              setError(
                caught instanceof ApiError ? caught.message : 'Could not reset this state.',
              );
            } finally {
              setSaving(null);
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
              const busy = saving === entry.state;

              return (
                <View key={entry.state} style={styles.row}>
                  <View style={styles.rowTop}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.state}>{entry.state}</Text>
                      <Text style={styles.meta}>
                        {entry.configured ? 'Set by you' : 'Store default'}
                        {entry.codEnabled ? '' : ' · COD off'}
                      </Text>
                    </View>
                    <Toggle
                      value={entry.codEnabled}
                      disabled={busy}
                      onValueChange={(next) =>
                        void save(entry.state, { codEnabled: next, codCharge: entry.codCharge })
                      }
                    />
                  </View>

                  {/* The charge is only meaningful while COD is offered, so a
                      disabled state hides the field rather than showing a
                      number that does nothing. */}
                  {entry.codEnabled ? (
                    <View style={styles.chargeRow}>
                      <Text style={styles.chargeLabel}>COD charge</Text>
                      <View style={styles.chargeField}>
                        <Text style={styles.rupee}>₹</Text>
                        <TextInput
                          value={draft ?? paiseToRupeeInput(entry.codCharge)}
                          onChangeText={(text) =>
                            setDrafts((current) => ({ ...current, [entry.state]: text }))
                          }
                          onBlur={() => {
                            if (draft === undefined) return;
                            const codCharge = rupeesToPaise(draft);
                            if (codCharge === entry.codCharge) {
                              setDrafts((current) => {
                                const { [entry.state]: _dropped, ...rest } = current;
                                return rest;
                              });
                              return;
                            }
                            void save(entry.state, { codEnabled: true, codCharge });
                          }}
                          keyboardType="decimal-pad"
                          returnKeyType="done"
                          editable={!busy}
                          selectTextOnFocus
                          style={styles.chargeInput}
                        />
                      </View>
                    </View>
                  ) : null}

                  {entry.configured ? (
                    <PressableScale
                      onPress={() => resetToDefault(entry)}
                      disabled={busy}
                      hitSlop={8}
                      style={styles.resetWrap}
                    >
                      <Text style={styles.reset}>
                        {busy ? 'Saving…' : 'Reset to store default'}
                      </Text>
                    </PressableScale>
                  ) : null}
                </View>
              );
            })}
          </Group>
        )}

        <Text style={styles.note}>
          Delivery addresses store the state as free text, so a customer who types it unusually
          falls back to the store default rather than their state's rule. Checkout always prices
          COD on the server — changing a figure here takes effect on the next order.
        </Text>
      </ScrollView>
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
    paddingHorizontal: spacing.md,
    minWidth: 110,
  },
  rupee: { ...typography.callout, color: colors.textMuted },
  chargeInput: {
    flex: 1,
    paddingVertical: spacing.sm + 2,
    fontSize: 17,
    color: colors.text,
    textAlign: 'right',
  },

  resetWrap: { alignSelf: 'flex-start', marginTop: spacing.md },
  reset: { ...typography.calloutStrong, color: colors.primary },

  note: {
    ...typography.caption,
    color: colors.textFaint,
    lineHeight: 19,
    marginTop: spacing.lg,
    paddingHorizontal: spacing.xs,
  },
});
