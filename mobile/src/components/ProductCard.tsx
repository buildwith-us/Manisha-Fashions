import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Icon } from './Icon';
import { PressableScale } from './motion';
import { motion } from '../theme/motion';
import { colors, radius, shadowSoft, spacing, typography } from '../theme';
import { formatPaise } from '../utils/money';
import type { Product } from '../api/types';

/**
 * A catalogue tile is the photograph and nothing else: no card, no border, no
 * badge over the image. Name and price sit directly on the ground beneath it,
 * and stock state is said in text rather than stamped across the picture.
 *
 * PRD 8.3 — expo-image with explicit sizing and a disk cache policy is the
 * primary fix for the image-related lag in the previous Flutter client. The
 * card is memoised so a FlatList re-render does not re-render every tile.
 */

interface Props {
  product: Product;
  onPress: (product: Product) => void;
  onToggleWishlist?: (product: Product) => void;
  wishlisted?: boolean;
  /** Staff view shows both tiers side by side. */
  showBothPrices?: boolean;
}

const BLURHASH_PLACEHOLDER = 'L6Pj0^i_.AyE_3t7t7R**0o#DgR4';

function ProductCardComponent({
  product,
  onPress,
  onToggleWishlist,
  wishlisted = false,
  showBothPrices = false,
}: Props) {
  const image = product.images[0];
  const lowStock = product.inStock && product.stock <= 5;

  return (
    <PressableScale
      onPress={() => onPress(product)}
      style={styles.card}
      accessibilityRole="button"
      accessibilityLabel={`${product.name}, ${formatPaise(product.price)}`}
    >
      <View style={[styles.imageWrapper, shadowSoft, !product.inStock && styles.imageSoldOut]}>
        {image ? (
          <Image
            source={image}
            style={styles.image}
            contentFit="cover"
            transition={180}
            cachePolicy="memory-disk"
            placeholder={{ blurhash: BLURHASH_PLACEHOLDER }}
          />
        ) : (
          <View style={[styles.image, styles.imageFallback]} />
        )}

        {onToggleWishlist ? (
          <PressableScale
            onPress={() => onToggleWishlist(product)}
            hitSlop={10}
            scaleTo={motion.pressScaleSmall}
            style={styles.wishlistButton}
            accessibilityRole="button"
            accessibilityLabel={wishlisted ? 'Remove from wishlist' : 'Save for later'}
          >
            <Icon
              name="heart"
              size={15}
              color={wishlisted ? colors.primary : colors.textMuted}
              filled={wishlisted}
            />
          </PressableScale>
        ) : null}
      </View>

      <Text style={[styles.name, !product.inStock && styles.nameSoldOut]} numberOfLines={2}>
        {product.name}
      </Text>

      <View style={styles.priceRow}>
        <Text style={[styles.price, !product.inStock && styles.priceSoldOut]}>
          {formatPaise(product.price)}
        </Text>
        {product.priceTier === 'wholesale' ? (
          <Text style={styles.strikePrice}>{formatPaise(product.retailPrice)}</Text>
        ) : null}
      </View>

      {/* Stock is a quiet line of text, not a block stamped over the photograph. */}
      {!product.inStock ? (
        <Text style={styles.note}>Sold out</Text>
      ) : lowStock ? (
        <Text style={[styles.note, styles.noteAccent]}>Only {product.stock} left</Text>
      ) : null}

      {/* Staff and admin see both tiers; a retail account never receives
          wholesalePrice from the API at all (PRD 8.4). */}
      {showBothPrices && product.wholesalePrice !== undefined ? (
        <Text style={styles.note}>
          Wholesale {formatPaise(product.wholesalePrice)} · Stock {product.stock}
        </Text>
      ) : null}
    </PressableScale>
  );
}

export const ProductCard = memo(ProductCardComponent);

const styles = StyleSheet.create({
  card: { flex: 1, margin: spacing.sm },
  pressed: { opacity: 0.7 },

  imageWrapper: {
    position: 'relative',
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: colors.background,
  },
  imageSoldOut: { opacity: 0.55 },
  image: { width: '100%', aspectRatio: 7 / 6 },
  imageFallback: { backgroundColor: colors.fill },
  wishlistButton: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 30,
    height: 30,
    borderRadius: radius.pill,
    backgroundColor: colors.glassStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },

  name: { ...typography.calloutStrong, color: colors.text, lineHeight: 20, marginTop: spacing.md },
  nameSoldOut: { color: colors.textFaint },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: spacing.xs },
  price: { ...typography.callout, color: colors.textMuted },
  priceSoldOut: { color: colors.textFaint },
  strikePrice: {
    ...typography.footnote,
    color: colors.textDisabled,
    textDecorationLine: 'line-through',
  },
  note: { ...typography.footnote, color: colors.textFaint, marginTop: spacing.xs },
  noteAccent: { color: colors.primary, fontWeight: '500' },
});
