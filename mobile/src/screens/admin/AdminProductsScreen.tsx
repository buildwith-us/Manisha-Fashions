import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  Divider,
  EmptyState,
  ErrorBanner,
  LargeTitle,
  ListRow,
  LoadingView,
  Screen,
} from '../../components/ui';
import { Icon } from '../../components/Icon';
import { PressableScale, StaggerItem } from '../../components/motion';
import { productApi } from '../../api/endpoints';
import { ApiError } from '../../api/client';
import { PERMISSIONS, usePermission } from '../../store/hooks';
import { colors, radius, shadow, shadowAccent, spacing, typography } from '../../theme';
import { formatPaise } from '../../utils/money';
import type { RootStackParamList } from '../../navigation/types';
import type { Pagination, Product } from '../../api/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/**
 * PRD 4.7 — screen 24. Both tiers on the line, stock on the right.
 *
 * The list stays a FlatList so a few hundred products still scroll cleanly; the
 * list *is* the inset grouped card rather than sitting inside one, which is
 * what keeps virtualisation and the card look in the same component.
 */
export function AdminProductsScreen() {
  const navigation = useNavigation<Nav>();
  const canCreate = usePermission(PERMISSIONS.PRODUCT_PRICE_MANAGE);

  const [items, setItems] = useState<Product[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (page = 1, query = search) => {
      if (page === 1) setLoading(true);
      else setLoadingMore(true);
      setError(null);

      try {
        const { data, pagination: meta } = await productApi.list({
          sort: 'newest',
          page,
          limit: 20,
          search: query.trim() || undefined,
          // Staff need to see deactivated products to bring them back.
          includeInactive: true,
        });
        setItems((current) => (page === 1 ? data : [...current, ...data]));
        setPagination(meta ?? null);
      } catch (caught) {
        setError(caught instanceof ApiError ? caught.message : 'Could not load products.');
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [search],
  );

  useFocusEffect(
    useCallback(() => {
      void load(1);
    }, [load]),
  );

  if (loading && items.length === 0) return <LoadingView variant="list" />;

  return (
    <Screen>
      {/* The two actions ride in LargeTitle's `right` slot, which is what it is
          for — the previous markup rebuilt the whole title block by hand to
          place them. The count moves into `caption`, directly under the title,
          matching the catalogue. */}
      <LargeTitle
        overline="Admin"
        title="Products"
        caption={
          (pagination ? `${pagination.total} in the catalogue` : `${items.length} loaded`) +
          (canCreate ? '' : ' · staff can edit stock and details, not prices')
        }
        right={
          <View style={styles.headerActions}>
            <PressableScale
              onPress={() => navigation.navigate('AdminCategories')}
              hitSlop={8}
              accessibilityRole="button"
            >
              <Text style={styles.link}>Categories</Text>
            </PressableScale>

            {/* PRD 8.9 — creating a product means setting both prices, so it is
                admin-only. Staff manage stock and content on existing products. */}
            {canCreate ? (
              <PressableScale
                onPress={() => navigation.navigate('AdminProductForm')}
                accessibilityRole="button"
                accessibilityLabel="Add a product"
                style={[styles.addButton, shadowAccent]}
              >
                <Icon name="plus" size={19} color={colors.textInverse} strokeWidth={2.2} />
              </PressableScale>
            ) : null}
          </View>
        }
      >
        <View style={styles.searchField}>
          <Icon name="search" size={17} color={colors.textPlaceholder} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            onSubmitEditing={() => void load(1)}
            placeholder="Name or SKU"
            placeholderTextColor={colors.textPlaceholder}
            returnKeyType="search"
            style={styles.searchInput}
          />
        </View>

      </LargeTitle>

      {error ? (
        <View style={styles.bannerWrap}>
          <ErrorBanner message={error} onRetry={() => void load(1)} />
        </View>
      ) : null}

      <FlatList
          // A search result stays tappable while the keyboard is open;
          // without this the first tap only dismisses the keyboard.
          keyboardShouldPersistTaps="handled"
        data={items}
        keyExtractor={(item) => item.id}
        style={[styles.card, shadow]}
        initialNumToRender={10}
        maxToRenderPerBatch={10}
        windowSize={7}
        ItemSeparatorComponent={Divider}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={() => void load(1)}
            tintColor={colors.primary}
          />
        }
        onEndReachedThreshold={0.4}
        onEndReached={() => {
          if (!loadingMore && pagination?.hasMore) void load(pagination.page + 1);
        }}
        ListEmptyComponent={
          <EmptyState
            icon="package"
            title="No products yet"
            message="Add your first piece to get started."
          />
        }
        ListFooterComponent={
          loadingMore ? (
            <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.xl }} />
          ) : null
        }
        renderItem={({ item, index }) => {
          const out = item.stock === 0;
          const low = item.stock > 0 && item.stock <= 5;

          return (
            <StaggerItem index={index}>
              <ListRow
              image={item.images[0]}
              withThumb
              title={item.name}
              subtitle={`${item.sku ? `${item.sku} · ` : ''}${
                item.isActive ? (item.category?.name ?? 'Uncategorised') : 'hidden from shop'
              }`}
              detail={
                <Text style={styles.prices} numberOfLines={1}>
                  {formatPaise(item.retailPrice)} retail
                  {item.wholesalePrice !== undefined ? (
                    <Text style={styles.tradePrice}>
                      {' · '}
                      {formatPaise(item.wholesalePrice)} trade
                    </Text>
                  ) : null}
                </Text>
              }
              trailingValue={String(item.stock)}
              trailingLabel={out ? 'out' : low ? 'low' : 'in stock'}
              trailingTone={low ? 'accent' : 'default'}
              dimmed={!item.isActive}
              onPress={() => navigation.navigate('AdminProductForm', { productId: item.id })}
              />
            </StaggerItem>
          );
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  link: { ...typography.calloutStrong, color: colors.primary, marginBottom: 4 },
  addButton: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },

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

  bannerWrap: { paddingHorizontal: spacing.xl },

  card: {
    marginHorizontal: spacing.xl,
    marginBottom: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  prices: { ...typography.caption, color: colors.textMuted, marginTop: 5 },
  tradePrice: { color: colors.primary, fontWeight: '500' },
});
