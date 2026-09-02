import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button, EmptyState, Screen } from '../../components/ui';
import { ReviewsSection, Stars } from '../../components/Reviews';
import { ProductCard } from '../../components/ProductCard';
import { Icon } from '../../components/Icon';
import { QuantityStepper } from '../../components/QuantityStepper';
import { PressableScale, Skeleton } from '../../components/motion';
import { productApi } from '../../api/endpoints';
import { ApiError } from '../../api/client';
import { useAppDispatch, useAppSelector, useIsStaff } from '../../store/hooks';
import { useAuthGate } from '../../hooks/useAuthGate';
import { addToCart } from '../../store/slices/cartSlice';
import { toggleWishlist } from '../../store/slices/productSlice';
import { colors, radius, spacing, typography } from '../../theme';
import { formatPaise } from '../../utils/money';
import type { RootStackParamList } from '../../navigation/types';
import type { Product, RatingSummary, Review } from '../../api/types';

type Nav = NativeStackNavigationProp<RootStackParamList, 'ProductDetail'>;
type Route = RouteProp<RootStackParamList, 'ProductDetail'>;

const { width } = Dimensions.get('window');
const HERO_HEIGHT = Math.round(width * 0.78);

/**
 * PRD 4.2 — image gallery, role-based price, stock status, cart + wishlist.
 *
 * Retail reads as a photograph with facts under it. Wholesale swaps the price
 * line for one quiet card holding the trade price, the retail price it is
 * measured against, and the saving.
 */
export function ProductDetailScreen() {
  const navigation = useNavigation<Nav>();
  // The hero is full-bleed, so this screen opts out of safe-area padding. The
  // controls and the scrim below therefore have to honour the inset themselves
  // — the previous hardcoded 44 was only ever right on one device.
  const insets = useSafeAreaInsets();
  const scrollY = useRef(new Animated.Value(0)).current;
  const { params } = useRoute<Route>();
  const dispatch = useAppDispatch();
  const isStaff = useIsStaff();
  const { isSignedIn, requireAuth } = useAuthGate();

  const wishlistIds = useAppSelector((state) => state.product.wishlistIds);
  const mutating = useAppSelector((state) => state.cart.mutating);

  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [activeImage, setActiveImage] = useState(0);
  const [feedback, setFeedback] = useState<string | null>(null);

  /* Reviews are fetched separately from the product so a slow review query
     never delays the price and the add-to-cart button. */
  const [summary, setSummary] = useState<RatingSummary>({
    average: 0,
    count: 0,
    breakdown: [0, 0, 0, 0, 0],
  });
  const [reviews, setReviews] = useState<Review[]>([]);
  const [reviewPage, setReviewPage] = useState(1);
  const [reviewsHasMore, setReviewsHasMore] = useState(false);
  const [loadingMoreReviews, setLoadingMoreReviews] = useState(false);
  const [writingReview, setWritingReview] = useState(false);
  const [submittingReview, setSubmittingReview] = useState(false);

  /** Same category, minus this product — a plain "you might also like" rail. */
  const [related, setRelated] = useState<Product[]>([]);

  useEffect(() => {
    let cancelled = false;

    productApi
      .detail(params.productId)
      .then((result) => {
        if (!cancelled) setProduct(result);
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setError(caught instanceof ApiError ? caught.message : 'Could not load this product.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [params.productId]);

  const loadReviews = useCallback(
    async (page: number) => {
      const result = await productApi.reviews(params.productId, page);
      setSummary(result.data.summary);
      setReviews((current) =>
        page === 1 ? result.data.items : [...current, ...result.data.items],
      );
      setReviewsHasMore(Boolean(result.pagination?.hasMore));
      setReviewPage(page);
    },
    [params.productId],
  );

  useEffect(() => {
    // Failure here is deliberately silent: the product is still perfectly
    // usable without its reviews, and an error banner over the price would be
    // out of proportion to what is missing.
    void loadReviews(1).catch(() => undefined);
  }, [loadReviews]);

  // Related products: same category, this one removed.
  useEffect(() => {
    if (!product?.category?.id) return;
    let cancelled = false;

    productApi
      .list({ category: product.category.id, sort: 'newest', page: 1, limit: 10 })
      .then((result) => {
        if (cancelled) return;
        setRelated(result.data.filter((entry) => entry.id !== product.id).slice(0, 8));
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [product?.category?.id, product?.id]);

  const myReview = reviews.find((review) => review.mine);

  const handleSubmitReview = async (input: { rating: number; comment?: string }) => {
    setSubmittingReview(true);
    try {
      await productApi.submitReview(params.productId, input);
      setWritingReview(false);
      await loadReviews(1);
      // The average shown beside the price comes from the product, so refresh
      // it too rather than letting the two disagree.
      setProduct(await productApi.detail(params.productId));
    } catch (caught) {
      setFeedback(caught instanceof ApiError ? caught.message : 'Could not save your review.');
      setTimeout(() => setFeedback(null), 3000);
    } finally {
      setSubmittingReview(false);
    }
  };

  const handleDeleteReview = async () => {
    try {
      await productApi.deleteReview(params.productId);
      await loadReviews(1);
      setProduct(await productApi.detail(params.productId));
    } catch {
      setFeedback('Could not remove your review.');
      setTimeout(() => setFeedback(null), 3000);
    }
  };

  const handleLoadMoreReviews = async () => {
    if (loadingMoreReviews) return;
    setLoadingMoreReviews(true);
    try {
      await loadReviews(reviewPage + 1);
    } finally {
      setLoadingMoreReviews(false);
    }
  };

  // Fades a status-bar backdrop in as the hero scrolls away. Without it the
  // product name rides directly under the clock once the image is gone.
  const statusScrimOpacity = scrollY.interpolate({
    inputRange: [HERO_HEIGHT - 120, HERO_HEIGHT - 40],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });

  const handleShare = () => {
    if (!product) return;
    // No deep link exists for a product yet, so the sheet carries the name and
    // price rather than a URL that would not open anything.
    void Share.share({
      message: `${product.name} — ${formatPaise(product.price)} at Manisha Fashions`,
    }).catch(() => undefined);
  };

  /** A guest is sent to sign-in; the add is replayed for them afterwards. */
  const handleAddToCart = () => {
    if (!product) return;
    requireAuth({ type: 'addToCart', productId: product.id, quantity }, async () => {
      const result = await dispatch(addToCart({ productId: product.id, quantity }));
      if (addToCart.fulfilled.match(result)) {
        setFeedback(`Added ${quantity} to your cart`);
        setTimeout(() => setFeedback(null), 2500);
      } else {
        setFeedback(typeof result.payload === 'string' ? result.payload : 'Could not add to cart');
        setTimeout(() => setFeedback(null), 3000);
      }
    });
  };

  /**
   * Buy now skips the cart entirely. Checkout is handed this product and this
   * quantity, and orders that alone — a customer with a full cart who buys one
   * piece pays for the piece, not the cart. A guest gets the same thing after
   * signing in, replayed from the pending intent.
   */
  const handleBuyNow = () => {
    if (!product) return;
    requireAuth({ type: 'buyNow', productId: product.id, quantity }, () => {
      navigation.navigate('Checkout', { buyNow: { productId: product.id, quantity } });
    });
  };

  const handleToggleWishlist = () => {
    if (!product) return;
    requireAuth({ type: 'toggleWishlist', productId: product.id }, () => {
      void dispatch(toggleWishlist(product.id));
    });
  };

  // Mirrors the loaded screen: full-bleed hero, then the title/price block.
  if (loading) {
    return (
      <Screen tone="plain" edges={[]}>
        <Skeleton height={420} style={styles.heroSkeleton} />
        <View style={styles.skeletonBody}>
          <Skeleton height={13} width="25%" />
          <Skeleton height={26} width="70%" style={{ marginTop: spacing.md }} />
          <Skeleton height={22} width="35%" style={{ marginTop: spacing.md }} />
          <Skeleton height={14} width="90%" style={{ marginTop: spacing.xl }} />
          <Skeleton height={14} width="80%" style={{ marginTop: spacing.sm }} />
        </View>
      </Screen>
    );
  }
  if (error || !product) {
    return (
      <Screen tone="plain">
        <EmptyState
          icon="info"
          title="Product unavailable"
          message={error ?? 'This product was not found.'}
        />
      </Screen>
    );
  }

  const wishlisted = wishlistIds.includes(product.id);
  const lowStock = product.inStock && product.stock <= 5;
  const isWholesale = product.priceTier === 'wholesale';
  const saving =
    isWholesale && product.retailPrice > 0
      ? Math.round(((product.retailPrice - product.price) / product.retailPrice) * 100)
      : 0;

  return (
    <Screen tone="plain" edges={[]}>
      <Animated.ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
        scrollEventThrottle={16}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
          useNativeDriver: true,
        })}
      >
        <View style={styles.hero}>
          {product.images.length > 0 ? (
            <ScrollView
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={(event) =>
                setActiveImage(Math.round(event.nativeEvent.contentOffset.x / width))
              }
            >
              {product.images.map((uri) => (
                <Image
                  key={uri}
                  source={uri}
                  style={styles.heroImage}
                  contentFit="cover"
                  transition={200}
                  cachePolicy="memory-disk"
                />
              ))}
            </ScrollView>
          ) : (
            <View style={styles.heroImage} />
          )}

          <View style={[styles.heroControls, { top: insets.top + spacing.sm }]} pointerEvents="box-none">
            <PressableScale
              onPress={() => navigation.goBack()}
              style={styles.glassButton}
              accessibilityRole="button"
              accessibilityLabel="Go back"
            >
              <Icon name="chevronLeft" size={19} color={colors.text} />
            </PressableScale>

            {isWholesale ? (
              <View style={styles.glassPill}>
                <Text style={styles.glassPillText}>Wholesale</Text>
              </View>
            ) : null}

            <View style={styles.heroActions}>
              <PressableScale
                onPress={handleShare}
                style={styles.glassButton}
                accessibilityRole="button"
                accessibilityLabel="Share this product"
              >
                <Icon name="send" size={17} color={colors.text} />
              </PressableScale>

              {!isStaff ? (
                <PressableScale
                  onPress={handleToggleWishlist}
                  style={styles.glassButton}
                  accessibilityRole="button"
                  accessibilityLabel={wishlisted ? 'Remove from wishlist' : 'Save for later'}
                >
                  <Icon
                    name="heart"
                    size={18}
                    color={wishlisted ? colors.primary : colors.text}
                    filled={wishlisted}
                  />
                </PressableScale>
              ) : null}
            </View>
          </View>

          {product.images.length > 1 ? (
            <View style={styles.dots} pointerEvents="none">
              {product.images.map((uri, index) => (
                <View key={uri} style={[styles.dot, index === activeImage && styles.dotActive]} />
              ))}
            </View>
          ) : null}
        </View>

        <View style={styles.body}>
          {product.category ? (
            <Text style={styles.category}>{product.category.name}</Text>
          ) : null}
          <Text style={styles.name}>{product.name}</Text>

          {/* Rating sits with the name rather than in the reviews block, so the
              social proof is visible without scrolling. Hidden entirely when
              there are no reviews — an empty star row reads as a bad score. */}
          {summary.count > 0 ? (
            <View style={styles.ratingRow}>
              <Stars value={summary.average} size="sm" />
              <Text style={styles.ratingValue}>{summary.average.toFixed(1)}</Text>
              <Text style={styles.ratingCount}>
                ({summary.count} review{summary.count === 1 ? '' : 's'})
              </Text>
            </View>
          ) : null}

          {isWholesale ? (
            <View style={styles.tradeCard}>
              <Text style={styles.tradeLabel}>Your trade price</Text>
              <View style={styles.tradeRow}>
                <Text style={styles.tradePrice}>{formatPaise(product.price)}</Text>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={styles.tradeRetail}>Retail {formatPaise(product.retailPrice)}</Text>
                  {saving > 0 ? <Text style={styles.tradeSaving}>Save {saving}%</Text> : null}
                </View>
              </View>
              <Text style={styles.tradeNote}>No minimum order quantity.</Text>
            </View>
          ) : (
            <>
              <View style={styles.priceRow}>
                <Text style={styles.price}>{formatPaise(product.price)}</Text>
              </View>
              <Text style={[styles.stockLine, !product.inStock && styles.stockLineOut]}>
                {product.inStock
                  ? lowStock
                    ? `Only ${product.stock} left`
                    : 'In stock'
                  : 'Out of stock'}
                {product.sku ? ` · SKU ${product.sku}` : ''}
              </Text>
            </>
          )}

          {/* Staff and admin see the other tier for reference. A retail account
              never receives wholesalePrice from the API (PRD 8.4). */}
          {isStaff && product.wholesalePrice !== undefined ? (
            <Text style={styles.staffNote}>
              Retail {formatPaise(product.retailPrice)} · Wholesale{' '}
              {formatPaise(product.wholesalePrice)} · Stock {product.stock}
            </Text>
          ) : null}

          <Text style={styles.description}>{product.description}</Text>

          {isWholesale ? (
            <View style={styles.specRow}>
              <Text style={styles.specLabel}>Available stock</Text>
              <Text style={styles.specValue}>
                {product.stock} piece{product.stock === 1 ? '' : 's'}
              </Text>
            </View>
          ) : null}

          {product.tags.length > 0 ? (
            <View style={styles.specCard}>
              {product.tags.map((tag, index) => (
                <View key={tag} style={[styles.specCardRow, index > 0 && styles.specCardDivided]}>
                  <Text style={styles.specLabel}>{tag}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>

        <ReviewsSection
          summary={summary}
          reviews={reviews}
          // Staff and admin manage the catalogue rather than shop it, so the
          // write control is a customer-only affordance.
          canWrite={isSignedIn && !isStaff}
          writing={writingReview}
          submitting={submittingReview}
          hasMore={reviewsHasMore}
          loadingMore={loadingMoreReviews}
          myReview={myReview}
          onStartWriting={() => setWritingReview(true)}
          onSubmit={handleSubmitReview}
          onDelete={handleDeleteReview}
          onLoadMore={handleLoadMoreReviews}
          signInPrompt={() =>
            requireAuth({ type: 'openTab', tab: 'Account' }, () => setWritingReview(true))
          }
        />

        {related.length > 0 ? (
          <View style={styles.relatedSection}>
            <Text style={styles.relatedTitle}>You might also like</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.relatedRail}
            >
              {related.map((entry) => (
                <View key={entry.id} style={styles.relatedCard}>
                  <ProductCard
                    product={entry}
                    onPress={(next) =>
                      // push, not replace: backing out returns to the product
                      // the customer came from.
                      navigation.push('ProductDetail', { productId: next.id })
                    }
                    showBothPrices={isStaff}
                  />
                </View>
              ))}
            </ScrollView>
          </View>
        ) : null}
      </Animated.ScrollView>

      <View style={styles.footer}>
        {feedback ? <Text style={styles.feedback}>{feedback}</Text> : null}

        {isStaff ? (
          <Button
            label="Edit this product"
            onPress={() => navigation.navigate('AdminProductForm', { productId: product.id })}
          />
        ) : (
          <>
            <View style={styles.footerRow}>
              <QuantityStepper
                quantity={quantity}
                onChange={setQuantity}
                min={1}
                max={Math.max(1, product.stock)}
                disabled={!product.inStock}
                size="lg"
              />
              <Button
                label={
                  product.inStock
                    ? isWholesale
                      ? `Add · ${formatPaise(product.price * quantity)}`
                      : 'Add to cart'
                    : 'Out of stock'
                }
                onPress={handleAddToCart}
                disabled={!product.inStock}
                loading={mutating}
                style={{ flex: 1 }}
              />
            </View>

            {/* Ghost, not a second filled button: this direction has one accent,
                and the same primary-plus-ghost pair is what order confirmation
                uses. Hidden when there is nothing to buy. */}
            {product.inStock ? (
              <Button
                label="Buy now"
                onPress={handleBuyNow}
                variant="ghost"
                style={styles.buyNow}
              />
            ) : null}
          </>
        )}
      </View>

      {/* Backs the status bar once the hero has scrolled away, so the product
          name never rides directly under the clock. */}
      <Animated.View
        pointerEvents="none"
        style={[styles.statusScrim, { height: insets.top, opacity: statusScrimOpacity }]}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  heroSkeleton: { borderRadius: 0 },
  skeletonBody: { paddingHorizontal: spacing.xl, paddingTop: spacing.xl },
  content: { paddingBottom: spacing.xl },

  statusScrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.surface,
  },
  hero: { height: HERO_HEIGHT, backgroundColor: colors.background },
  heroImage: { width, height: HERO_HEIGHT },
  heroControls: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  heroActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  glassButton: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: colors.glass,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glassPill: {
    paddingHorizontal: spacing.lg - 2,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.glass,
  },
  glassPillText: { ...typography.tiny, fontWeight: '600', color: colors.text },
  dots: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: spacing.lg,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: radius.pill,
    backgroundColor: colors.glassFaint,
  },
  dotActive: { backgroundColor: colors.surface },

  body: { paddingHorizontal: spacing.xl, paddingTop: spacing.xl + 4 },
  category: { ...typography.footnoteStrong, color: colors.textFaint },
  name: { ...typography.title2, color: colors.text, lineHeight: 32, marginTop: spacing.sm },

  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.md, marginTop: spacing.lg },
  price: { ...typography.amount, color: colors.text },
  stockLine: { ...typography.captionStrong, color: colors.success, marginTop: spacing.sm },
  stockLineOut: { color: colors.textFaint },
  staffNote: { ...typography.footnote, color: colors.textFaint, marginTop: spacing.sm },

  tradeCard: {
    marginTop: spacing.xl,
    padding: spacing.xl,
    borderRadius: radius.xl,
    backgroundColor: colors.background,
  },
  tradeLabel: { ...typography.footnoteStrong, color: colors.textFaint },
  tradeRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  tradePrice: { ...typography.hero, color: colors.primary },
  tradeRetail: { ...typography.caption, color: colors.textFaint },
  tradeSaving: { ...typography.captionStrong, fontWeight: '600', color: colors.success, marginTop: 4 },
  tradeNote: { ...typography.caption, color: colors.textFaint, marginTop: spacing.md, lineHeight: 21 },

  description: { ...typography.body, color: colors.textMuted, lineHeight: 26, marginTop: spacing.xl },

  specCard: {
    marginTop: spacing.xl,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.lg,
    backgroundColor: colors.background,
  },
  specCardRow: { paddingVertical: spacing.md + 2 },
  specCardDivided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  specRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    marginTop: spacing.md,
  },
  specLabel: { ...typography.callout, color: colors.textMuted },
  specValue: { ...typography.calloutStrong, color: colors.text },

  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  ratingValue: { ...typography.calloutStrong, color: colors.text },
  ratingCount: { ...typography.footnote, color: colors.textFaint },

  relatedSection: { marginTop: spacing.xxl, gap: spacing.md },
  relatedTitle: {
    ...typography.title,
    color: colors.text,
    paddingHorizontal: spacing.xl,
  },
  relatedRail: { paddingHorizontal: spacing.xl, gap: spacing.md },
  // The card is built for a 2-up grid, so it needs an explicit width in a rail.
  relatedCard: { width: Math.round(width * 0.42) },

  footer: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
    backgroundColor: colors.surface,
  },
  footerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  buyNow: { marginTop: spacing.sm },
  feedback: { ...typography.footnote, color: colors.success, marginBottom: spacing.md },
});
