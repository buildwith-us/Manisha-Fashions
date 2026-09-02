import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Chip, EmptyState, ErrorBanner, LargeTitle, LoadingView, Screen } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { ProductCard } from '../../components/ProductCard';
import { PressableScale, StaggerItem } from '../../components/motion';
import { useAppDispatch, useAppSelector, useIsStaff } from '../../store/hooks';
import { useAuthGate } from '../../hooks/useAuthGate';
import {
  fetchCategories,
  fetchProducts,
  fetchWishlist,
  setFilters,
  setSearch,
  toggleWishlist,
} from '../../store/slices/productSlice';
import { fetchCart } from '../../store/slices/cartSlice';
import { colors, radius, spacing, typography } from '../../theme';
import type { RootStackParamList } from '../../navigation/types';
import type { Product } from '../../api/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/**
 * PRD 4.2 — category browsing, keyword search, filters/sort, and paginated
 * loading via FlatList windowing for smooth scrolling.
 *
 * A large title over a quiet grid: the photographs carry the screen, and the
 * only accent is the price tier badge.
 */
export function CatalogScreen() {
  const navigation = useNavigation<Nav>();
  const dispatch = useAppDispatch();
  const isStaff = useIsStaff();
  const { isSignedIn, requireAuth } = useAuthGate();

  const {
    items,
    pagination,
    categories,
    filters,
    wishlistIds,
    loading,
    loadingMore,
    refreshing,
    error,
    accessBlocked,
  } = useAppSelector((state) => state.product);
  const user = useAppSelector((state) => state.auth.user);

  const [searchText, setSearchText] = useState(filters.search ?? '');

  useEffect(() => {
    // Catalogue and categories are public; the rest need an account, and
    // firing them as a guest would 401 and tear down the session.
    void dispatch(fetchCategories());
    void dispatch(fetchProducts({ page: 1 }));
    if (!isSignedIn) return;
    void dispatch(fetchCart());
    void dispatch(fetchWishlist());
  }, [dispatch, isSignedIn]);

  // Debounce the search box so typing does not fire a request per keystroke.
  useEffect(() => {
    const handle = setTimeout(() => {
      if ((filters.search ?? '') !== searchText.trim()) {
        dispatch(setSearch(searchText));
        void dispatch(fetchProducts({ page: 1 }));
      }
    }, 400);
    return () => clearTimeout(handle);
  }, [searchText, filters.search, dispatch]);

  const handleCategory = useCallback(
    (categoryId?: string) => {
      dispatch(setFilters({ category: categoryId }));
      void dispatch(fetchProducts({ page: 1 }));
    },
    [dispatch],
  );

  const handleEndReached = useCallback(() => {
    if (loadingMore || loading || !pagination?.hasMore) return;
    void dispatch(fetchProducts({ page: pagination.page + 1 }));
  }, [dispatch, loading, loadingMore, pagination]);

  const handleRefresh = useCallback(() => {
    void dispatch(fetchProducts({ page: 1, refresh: true }));
  }, [dispatch]);

  const openProduct = useCallback(
    (product: Product) => navigation.navigate('ProductDetail', { productId: product.id }),
    [navigation],
  );

  const handleWishlist = useCallback(
    (product: Product) => {
      // Guests get sign-in, then the save is applied for them.
      requireAuth({ type: 'toggleWishlist', productId: product.id }, () => {
        void dispatch(toggleWishlist(product.id));
      });
    },
    [dispatch, requireAuth],
  );

  const activeFilterCount =
    (filters.category ? 1 : 0) +
    (filters.minPrice !== undefined || filters.maxPrice !== undefined ? 1 : 0) +
    (filters.sort !== 'newest' ? 1 : 0) +
    (filters.inStockOnly ? 1 : 0);

  if (accessBlocked) {
    return (
      <Screen>
        <EmptyState icon="clock" title="Approval pending" message={accessBlocked} />
      </Screen>
    );
  }

  return (
    <Screen>
      {/* The header was a hand-rolled copy of LargeTitle — same paddings, same
          type tokens, but a one-off 6px offset instead of the spacing scale.
          Using the primitive keeps Home consistent with every other large-title
          screen, and the count moves up here so it is legible on arrival
          rather than only after scrolling to the end of the grid. */}
      <LargeTitle
        overline={user?.name ? `Hello, ${user.name}` : 'Welcome'}
        title="Collection"
        caption={
          pagination && items.length > 0
            ? `${pagination.total} piece${pagination.total === 1 ? '' : 's'}`
            : undefined
        }
      >
        <View style={styles.searchRow}>
          <View style={styles.searchField}>
            <Icon name="search" size={17} color={colors.textPlaceholder} />
            <TextInput
              value={searchText}
              onChangeText={setSearchText}
              placeholder="Search necklaces, jhumkas"
              placeholderTextColor={colors.textPlaceholder}
              style={styles.searchInput}
              returnKeyType="search"
              autoCorrect={false}
            />
          </View>
          <PressableScale
            onPress={() => navigation.navigate('Filters')}
            style={styles.filterButton}
            accessibilityRole="button"
            accessibilityLabel="Filter and sort"
          >
            <Icon name="sliders" size={19} color={colors.text} strokeWidth={1.8} />
            {activeFilterCount > 0 ? <View style={styles.filterDot} /> : null}
          </PressableScale>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
          style={styles.chipsRow}
        >
          <Chip label="All" active={!filters.category} onPress={() => handleCategory(undefined)} />
          {categories.map((category) => (
            <Chip
              key={category.id}
              label={category.name}
              active={filters.category === category.id}
              onPress={() => handleCategory(category.id)}
            />
          ))}
        </ScrollView>
      </LargeTitle>

      {error ? (
        <View style={styles.bannerWrap}>
          <ErrorBanner message={error} onRetry={handleRefresh} />
        </View>
      ) : null}

      {loading && items.length === 0 ? (
        <LoadingView variant="grid" />
      ) : (
        <FlatList
          // A search result stays tappable while the keyboard is open;
          // without this the first tap only dismisses the keyboard.
          keyboardShouldPersistTaps="handled"
          data={items}
          keyExtractor={(item) => item.id}
          numColumns={2}
          renderItem={({ item, index }) => (
            // flex:1 on the wrapper so the two-column layout is unchanged —
            // the card itself is flex:1 and would otherwise collapse.
            <StaggerItem index={index} style={styles.gridCell}>
              <ProductCard
                product={item}
                onPress={openProduct}
                onToggleWishlist={isStaff ? undefined : handleWishlist}
                wishlisted={wishlistIds.includes(item.id)}
                showBothPrices={isStaff}
              />
            </StaggerItem>
          )}
          contentContainerStyle={styles.list}
          // FlatList windowing — the PRD's fix for the previous client's
          // scroll performance on long catalogues.
          initialNumToRender={6}
          maxToRenderPerBatch={8}
          windowSize={7}
          removeClippedSubviews
          onEndReached={handleEndReached}
          onEndReachedThreshold={0.4}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={colors.primary}
            />
          }
          ListEmptyComponent={
            <EmptyState
              icon="search"
              title="Nothing matches yet"
              message="Try a different category, or clear your filters."
            />
          }
          ListFooterComponent={
            loadingMore ? (
              <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.xl }} />
            ) : pagination && items.length > 0 ? (
              <Text style={styles.endOfList}>
                {pagination.hasMore
                  ? `${items.length} of ${pagination.total} pieces`
                  : `${pagination.total} piece${pagination.total === 1 ? '' : 's'} in the collection`}
              </Text>
            ) : null
          }
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({

  searchRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  searchField: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
    backgroundColor: colors.fill,
    borderRadius: 12,
    paddingHorizontal: spacing.md + 2,
  },
  searchInput: { flex: 1, paddingVertical: spacing.md, fontSize: 16, color: colors.text },
  filterButton: {
    width: 44,
    borderRadius: 12,
    backgroundColor: colors.fill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterDot: {
    position: 'absolute',
    top: 9,
    right: 9,
    width: 7,
    height: 7,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
  },

  chipsRow: { flexGrow: 0, marginTop: spacing.lg, marginHorizontal: -spacing.xl },
  chips: { paddingHorizontal: spacing.xl, gap: spacing.sm },

  bannerWrap: { paddingHorizontal: spacing.xl, paddingTop: spacing.md },

  gridCell: { flex: 1 },
  list: { paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.xl },
  endOfList: {
    ...typography.caption,
    color: colors.textFaint,
    textAlign: 'center',
    marginVertical: spacing.xl,
  },
});
