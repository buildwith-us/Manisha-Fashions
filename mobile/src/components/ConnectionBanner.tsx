import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  getConnectionState,
  subscribeConnection,
  type ConnectionState,
} from '../api/connection';
import { colors, radius, shadowSoft, spacing, typography } from '../theme';

/**
 * A small pill over the top of every screen while the store's API is slow to
 * answer — typically the hosted backend waking from sleep, which can take
 * ~30 s. The API client keeps retrying safe requests meanwhile, so this says
 * "Connecting to store…" rather than showing an error the user can do nothing
 * about. It disappears the moment a request gets through.
 */
export function ConnectionBanner() {
  const insets = useSafeAreaInsets();
  const [state, setState] = useState<ConnectionState>(getConnectionState());

  useEffect(() => subscribeConnection(setState), []);

  if (state === 'online') return null;

  return (
    <View pointerEvents="none" style={[styles.wrap, { top: insets.top + spacing.sm }]}>
      <View
        style={[styles.pill, shadowSoft]}
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
      >
        {state === 'connecting' ? <ActivityIndicator size="small" color={colors.textMuted} /> : null}
        <Text style={styles.label}>
          {state === 'connecting' ? 'Connecting to store…' : "Can't reach the store — check your connection"}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 1000 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  label: { ...typography.footnoteStrong, color: colors.text },
});
