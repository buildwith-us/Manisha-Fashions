import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  ErrorBanner,
  Group,
  LargeTitle,
  ListRow,
  Row,
  Screen,
  SectionLabel,
  StatCard,
} from '../../components/ui';
import { adminApi } from '../../api/endpoints';
import { BlockSkeleton, Skeleton } from '../../components/motion';
import { ApiError } from '../../api/client';
import { PERMISSIONS, useAppSelector, usePermission } from '../../store/hooks';
import { colors, spacing, typography } from '../../theme';
import { formatPaise } from '../../utils/money';
import type { RootStackParamList } from '../../navigation/types';
import type { DashboardSummary } from '../../api/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/**
 * PRD 4.7 — screen 23. Four numbers, then what needs doing.
 *
 * The stat grid is the only place the accent glow is used on this side of the
 * app, and only under the two counts that are actionable — a glow on all four
 * would stop meaning "look here".
 */
export function AdminDashboardScreen() {
  const navigation = useNavigation<Nav>();
  const user = useAppSelector((state) => state.auth.user);
  const canApproveWholesale = usePermission(PERMISSIONS.WHOLESALE_APPROVE);

  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setSummary(await adminApi.dashboard());
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not load the dashboard.');
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

  // The dashboard is a 2x2 stat grid over a list, so the placeholder is too —
  // a generic block here would promise the wrong shape.
  if (loading && !summary) {
    return (
      <Screen>
        <View style={styles.header}>
          <Skeleton height={12} width="35%" />
          <Skeleton height={30} width="55%" style={{ marginTop: spacing.sm }} />
        </View>
        <View style={styles.statGrid}>
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} height={110} style={styles.statSkeleton} />
          ))}
        </View>
        <BlockSkeleton rows={3} />
      </Screen>
    );
  }

  const pendingApprovals = summary?.pendingWholesaleApprovals ?? 0;
  const awaitingPacking = summary?.ordersByStatus?.placed ?? 0;
  const lowStock = summary?.lowStockProducts ?? [];
  const threshold = summary?.lowStockThreshold ?? 5;

  return (
    <Screen>
      <LargeTitle
        overline={`${user?.accountType === 'admin' ? 'Admin' : 'Staff'} · Manisha Fashions`}
        title={user?.name ? `Hello, ${user.name}` : 'Today'}
      />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
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
        {error ? <ErrorBanner message={error} onRetry={load} /> : null}

        <View style={styles.statGrid}>
          <StatCard
            label="Orders today"
            value={String(summary?.todaysOrders ?? 0)}
            footnote={`${awaitingPacking} waiting to be packed`}
            onPress={() => navigation.navigate('AdminTabs', { screen: 'AdminOrders' })}
          />
          <StatCard
            label="Revenue today"
            value={formatPaise(summary?.todaysRevenue ?? 0)}
            footnote="Placed and paid today"
          />
          <StatCard
            label="Wholesale pending"
            value={String(pendingApprovals)}
            tone={pendingApprovals > 0 ? 'accent' : 'default'}
            footnote={pendingApprovals > 0 ? 'Waiting on you' : 'Nothing waiting'}
            footnoteTone={pendingApprovals > 0 ? 'accent' : 'muted'}
            emphasis={pendingApprovals > 0}
            onPress={
              canApproveWholesale
                ? () => navigation.navigate('AdminTabs', { screen: 'Wholesale' })
                : undefined
            }
          />
          <StatCard
            label="Low stock"
            value={String(lowStock.length)}
            footnote={`Under ${threshold} pieces`}
            tone={lowStock.length > 0 ? 'accent' : 'default'}
            emphasis={lowStock.length > 0}
            onPress={() => navigation.navigate('AdminTabs', { screen: 'Manage' })}
          />
        </View>

        <View style={styles.block}>
          <SectionLabel>Needs you today</SectionLabel>
          <Group>
            {canApproveWholesale && pendingApprovals > 0 ? (
              <Row
                label={`${pendingApprovals} wholesale application${pendingApprovals === 1 ? '' : 's'}`}
                detail="Approve or reject to unlock trade pricing"
                chevron
                onPress={() => navigation.navigate('AdminTabs', { screen: 'Wholesale' })}
              />
            ) : null}

            {awaitingPacking > 0 ? (
              <Row
                label={`${awaitingPacking} order${awaitingPacking === 1 ? '' : 's'} waiting to be packed`}
                detail="Move them to processing once packed"
                chevron
                onPress={() =>
                  navigation.navigate('AdminTabs', {
                    screen: 'AdminOrders',
                    params: { status: 'placed' },
                  })
                }
              />
            ) : null}

            {lowStock.length > 0 ? (
              <Row
                label={`${lowStock.length} product${lowStock.length === 1 ? '' : 's'} running low`}
                detail={`At or under ${threshold} pieces`}
                chevron
                onPress={() => navigation.navigate('AdminTabs', { screen: 'Manage' })}
              />
            ) : null}

            {pendingApprovals === 0 && awaitingPacking === 0 && lowStock.length === 0 ? (
              <Row label="Nothing needs you" detail="The shop is running clean today." tone="muted" />
            ) : null}
          </Group>
        </View>

        {lowStock.length > 0 ? (
          <View style={styles.block}>
            <SectionLabel>Low stock · at or under {threshold}</SectionLabel>
            <Group>
              {lowStock.map((product) => (
                <ListRow
                  key={product.id}
                  image={product.images[0]}
                  title={product.name}
                  subtitle={`${product.sku ? `${product.sku} · ` : ''}${
                    product.category?.name ?? 'Uncategorised'
                  }`}
                  detail={formatPaise(product.retailPrice)}
                  trailingValue={String(product.stock)}
                  trailingLabel={product.stock === 0 ? 'out' : 'low'}
                  trailingTone="accent"
                  onPress={() =>
                    navigation.navigate('AdminProductForm', { productId: product.id })
                  }
                />
              ))}
            </Group>
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  statSkeleton: { width: '48%' },
  header: { paddingHorizontal: spacing.xl, paddingTop: spacing.lg, paddingBottom: spacing.lg },

  scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xl },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  block: { marginTop: spacing.xl + 4 },
});
