import { useCallback, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button, EmptyState, LargeTitle, Screen } from '../../components/ui';
import { ProductCard } from '../../components/ProductCard';
import { StaggerItem } from '../../components/motion';
import { wishlistApi } from '../../api/endpoints';
import { useAppDispatch } from '../../store/hooks';
import { toggleWishlist } from '../../store/slices/productSlice';
import { colors, spacing, typography } from '../../theme';
import type { RootStackParamList } from '../../navigation/types';
import type { Product } from '../../api/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/** PRD 4.2 — "Save for later". Price drops and stock are noted in text. */
export function WishlistScreen() {
  const navigation = useNavigation<Nav>();
  const dispatch = useAppDispatch();

  const [items, setItems] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await wishlistApi.list());
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const handleRemove = async (product: Product) => {
    // Optimistic: the tile disappears immediately, then the server confirms.
    setItems((current) => current.filter((entry) => entry.id !== product.id));
    const result = await dispatch(toggleWishlist(product.id));
    if (toggleWishlist.fulfilled.match(result)) {
      setItems(result.payload.items);
    }
  };

  if (items.length === 0 && !loading) {
    return (
      <Screen>
        <EmptyState
          icon="heart"
          title="Nothing saved yet"
          message="Tap the heart on any piece to keep it here for later."
          action={
            <Button
              label="Browse the collection"
              onPress={() => navigation.navigate('CustomerTabs', { screen: 'Catalog' })}
              fullWidth={false}
            />
          }
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <LargeTitle
        title="Saved"
        caption={`${items.length} piece${items.length === 1 ? '' : 's'}`}
      />

      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        numColumns={2}
        contentContainerStyle={styles.list}
        initialNumToRender={6}
        maxToRenderPerBatch={8}
        windowSize={7}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.primary} />
        }
        renderItem={({ item, index }) => (
          <StaggerItem index={index} style={styles.gridCell}>
            <ProductCard
              product={item}
              onPress={(product) => navigation.navigate('ProductDetail', { productId: product.id })}
              onToggleWishlist={handleRemove}
              wishlisted
            />
          </StaggerItem>
        )}
        ListFooterComponent={
          items.length > 0 ? (
            <Text style={styles.footer}>
              {items.length} saved piece{items.length === 1 ? '' : 's'}
            </Text>
          ) : null
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  gridCell: { flex: 1 },
  list: { paddingHorizontal: spacing.md, paddingBottom: spacing.xl },
  footer: {
    ...typography.caption,
    color: colors.textFaint,
    textAlign: 'center',
    marginVertical: spacing.xl,
  },
});
