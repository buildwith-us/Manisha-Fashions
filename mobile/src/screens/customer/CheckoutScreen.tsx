import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { BlockSkeleton, PressableScale, Skeleton } from '../../components/motion';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  Button,
  EmptyState,
  ErrorBanner,
  Group,
  NavBar,
  Screen,
  SectionLabel,
  SelectionMark,
} from '../../components/ui';
import { configApi, productApi, type StoreConfig } from '../../api/endpoints';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { checkout, clearError, fetchCart } from '../../store/slices/cartSlice';
import { fetchAddresses } from '../../store/slices/authSlice';
import { colors, radius, shadow, spacing, typography } from '../../theme';
import { formatPaise } from '../../utils/money';
import type { RootStackParamList } from '../../navigation/types';
import type { PaymentMethod, Product } from '../../api/types';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Checkout'>;
type Route = RouteProp<RootStackParamList, 'Checkout'>;

/**
 * PRD 4.3 / 4.4 — order summary, address selection, and payment method.
 * Three grouped decisions and one total: Razorpay orders ship free, COD adds
 * the flat shipping charge the server owns.
 *
 * Two sources feed the same screen. Without params it checks out the saved
 * cart. With `buyNow` it orders a single product and never touches the cart —
 * the server enforces that too, so the cart survives even if this screen is
 * wrong about it.
 */
export function CheckoutScreen() {
  const navigation = useNavigation<Nav>();
  const { params } = useRoute<Route>();
  const dispatch = useAppDispatch();
  const buyNow = params?.buyNow;

  const cart = useAppSelector((state) => state.cart.cart);
  const placingOrder = useAppSelector((state) => state.cart.placingOrder);
  const error = useAppSelector((state) => state.cart.error);
  const addresses = useAppSelector((state) => state.auth.user?.addresses ?? []);

  const [config, setConfig] = useState<StoreConfig | null>(null);
  /** Settled either way — `config === null` alone cannot tell loading from failed. */
  const [configLoaded, setConfigLoaded] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('razorpay');

  /* The one product a Buy-now checkout is ordering. Its price comes from the
     API at the buyer's tier — this screen never computes money, it only adds
     the server's unit price up. `null` while loading, `false` once the fetch
     has failed, which is what separates "still waiting" from "gave up". */
  const [buyNowProduct, setBuyNowProduct] = useState<Product | null | false>(null);

  useEffect(() => {
    void dispatch(fetchAddresses());
    configApi
      .get()
      .then((result) => {
        setConfig(result);
        // Fall back to COD when online payment is not configured.
        if (!result.razorpayEnabled) setPaymentMethod('cod');
      })
      .catch(() => setConfig(null))
      .finally(() => setConfigLoaded(true));
  }, [dispatch]);

  useEffect(() => {
    // A Buy-now checkout deliberately does not fetch the cart: reading it would
    // only invite the summary to drift toward showing items nobody is buying.
    if (!buyNow) {
      void dispatch(fetchCart());
      return;
    }

    let cancelled = false;
    productApi
      .detail(buyNow.productId)
      .then((result) => {
        if (!cancelled) setBuyNowProduct(result);
      })
      .catch(() => {
        if (!cancelled) setBuyNowProduct(false);
      });

    return () => {
      cancelled = true;
    };
  }, [buyNow, dispatch]);

  /*
     Derived, not held in state. "Change" opens the Addresses screen, which
     records the choice by making that address the default — so the default is
     the selection. Latching the first one into state meant coming back from
     that screen changed nothing: the old address stayed on screen and was the
     one the order shipped to.
  */
  const selectedAddress = addresses.find((entry) => entry.isDefault) ?? addresses[0];
  const selectedAddressId = selectedAddress?.id ?? null;

  const shippingCharge = useMemo(() => {
    if (!config) return 0;
    return paymentMethod === 'cod' ? config.codShippingCharge : config.prepaidShippingCharge;
  }, [config, paymentMethod]);

  const subtotal = buyNow
    ? buyNowProduct
      ? buyNowProduct.price * buyNow.quantity
      : 0
    : (cart?.subtotal ?? 0);
  const total = subtotal + shippingCharge;

  const handlePlaceOrder = async () => {
    if (!selectedAddressId) return;

    const result = await dispatch(
      checkout({ addressId: selectedAddressId, paymentMethod, buyNow }),
    );
    if (!checkout.fulfilled.match(result)) return;

    const { order, payment } = result.payload;

    if (order.paymentMethod === 'razorpay' && payment) {
      navigation.replace('RazorpayCheckout', { orderId: order.id, handle: payment });
      return;
    }
    navigation.replace('OrderConfirmation', { orderId: order.id });
  };

  // Waiting on whichever source this checkout is built from. The skeleton
  // mirrors the loaded screen — three grouped blocks, the total, the pay button
  // — so nothing jumps when the data arrives. The NavBar is kept: returning a
  // bare LoadingView dropped it, leaving no way back while the cart loaded.
  // A Buy-now checkout also waits on config, because that is what says whether
  // the server can honour it at all.
  if (buyNow ? buyNowProduct === null || !configLoaded : !cart) {
    return (
      <Screen edges={['top']}>
        <NavBar title="Checkout" onBack={() => navigation.goBack()} />
        <BlockSkeleton rows={2} />
        <BlockSkeleton rows={2} />
        <BlockSkeleton rows={3} />
        <View style={styles.skeletonFooter}>
          <Skeleton height={18} width="30%" />
          <Skeleton height={52} style={styles.skeletonButton} />
        </View>
      </Screen>
    );
  }

  /* An API that does not advertise buyNow support would strip the field and
     charge for the entire cart — zod drops unknown keys, so the response would
     look like a perfectly ordinary success. There is no way to detect that
     after the fact, so the order is refused before it is placed. Resolves
     itself the moment the backend is redeployed. */
  if (buyNow && config?.buyNowSupported !== true) {
    return (
      <Screen edges={['top']}>
        <NavBar title="Checkout" onBack={() => navigation.goBack()} />
        <EmptyState
          icon="info"
          title="Buy now is unavailable"
          message="This store's server needs updating before single-item orders can be placed. Add the item to your cart and check out as usual."
        />
      </Screen>
    );
  }

  // A Buy-now product that failed to load is a dead end — there is nothing to
  // order and no cart to fall back on. Say so rather than holding a skeleton on
  // screen for good.
  if (buyNowProduct === false) {
    return (
      <Screen edges={['top']}>
        <NavBar title="Checkout" onBack={() => navigation.goBack()} />
        <EmptyState
          icon="info"
          title="Product unavailable"
          message="We could not load this product. It may no longer be on sale."
        />
      </Screen>
    );
  }

  const cartItems = cart?.items ?? [];
  const [firstItem, ...restItems] = cartItems;
  const restCount = restItems.reduce((sum, item) => sum + item.quantity, 0);
  const restTotal = restItems.reduce((sum, item) => sum + item.lineTotal, 0);
  // Nothing to order is the one state that blocks the button beyond a missing
  // address: an empty cart, or a Buy-now product that never arrived.
  const hasSomethingToOrder = buyNow ? Boolean(buyNowProduct) : cartItems.length > 0;

  return (
    <Screen edges={['top']}>
      <NavBar title="Checkout" onBack={() => navigation.goBack()} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {error ? <ErrorBanner message={error} onRetry={() => dispatch(clearError())} /> : null}

        <SectionLabel>Deliver to</SectionLabel>
        {selectedAddress ? (
          <View style={[styles.addressCard, shadow]}>
            <View style={styles.addressTop}>
              <View style={{ flex: 1 }}>
                <Text style={styles.addressName}>{selectedAddress.fullName}</Text>
                <Text style={styles.addressLine}>
                  {selectedAddress.line1}
                  {selectedAddress.line2 ? `, ${selectedAddress.line2}` : ''}
                  {'\n'}
                  {selectedAddress.city}, {selectedAddress.state} {selectedAddress.pincode}
                </Text>
                <Text style={styles.addressLine}>{selectedAddress.phone}</Text>
              </View>
              <PressableScale
                onPress={() => navigation.navigate('Addresses', { selectMode: true })}
                hitSlop={8}
              >
                <Text style={styles.action}>Change</Text>
              </PressableScale>
            </View>
          </View>
        ) : (
          <View style={[styles.addressCard, shadow]}>
            <Text style={styles.addressLine}>
              You have no saved addresses yet. Add one to continue.
            </Text>
            <Button
              label="Add a delivery address"
              onPress={() => navigation.navigate('AddressForm')}
              variant="secondary"
              style={{ marginTop: spacing.lg }}
            />
          </View>
        )}

        <View style={styles.block}>
          <SectionLabel>Payment</SectionLabel>
          <Group>
            <PaymentOption
              selected={paymentMethod === 'razorpay'}
              disabled={config ? !config.razorpayEnabled : false}
              onPress={() => setPaymentMethod('razorpay')}
              title="Pay online"
              subtitle="UPI, cards & netbanking"
              note={config && !config.razorpayEnabled ? 'Unavailable' : 'Free'}
              noteTone={config && !config.razorpayEnabled ? 'muted' : 'success'}
            />
            <PaymentOption
              selected={paymentMethod === 'cod'}
              onPress={() => setPaymentMethod('cod')}
              title="Cash on delivery"
              subtitle="Pay the courier on arrival"
              note={config ? `+${formatPaise(config.codShippingCharge)}` : undefined}
            />
          </Group>
        </View>

        <View style={styles.block}>
          {/* "Buying now" rather than "Order summary": with a single line in the
              card it is the clearest way to say the cart is not part of this. */}
          <SectionLabel>{buyNow ? 'Buying now' : 'Order summary'}</SectionLabel>
          <View style={[styles.summaryCard, shadow]}>
            {buyNow && buyNowProduct ? (
              <SummaryLine
                label={`${buyNow.quantity} × ${buyNowProduct.name}`}
                value={formatPaise(buyNowProduct.price * buyNow.quantity)}
              />
            ) : (
              <>
                {firstItem ? (
                  <SummaryLine
                    label={`${firstItem.quantity} × ${firstItem.product.name}`}
                    value={formatPaise(firstItem.lineTotal)}
                  />
                ) : null}
                {restCount > 0 ? (
                  <SummaryLine
                    label={`${restCount} more item${restCount === 1 ? '' : 's'}`}
                    value={formatPaise(restTotal)}
                    divided
                  />
                ) : null}
              </>
            )}
            <SummaryLine
              label="Shipping"
              value={shippingCharge === 0 ? 'Free' : formatPaise(shippingCharge)}
              valueTone={shippingCharge === 0 ? 'success' : 'default'}
              divided
            />
          </View>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Total</Text>
          <Text style={styles.totalValue}>{formatPaise(total)}</Text>
        </View>
        <Button
          label={paymentMethod === 'cod' ? 'Place order' : 'Pay now'}
          onPress={handlePlaceOrder}
          loading={placingOrder}
          disabled={!selectedAddressId || !hasSomethingToOrder}
        />
      </View>
    </Screen>
  );
}

/** A grouped row whose leading mark carries the selection. */
function PaymentOption({
  selected,
  onPress,
  title,
  subtitle,
  note,
  noteTone = 'muted',
  disabled = false,
}: {
  selected: boolean;
  onPress: () => void;
  title: string;
  subtitle: string;
  note?: string;
  noteTone?: 'muted' | 'success';
  disabled?: boolean;
}) {
  return (
    <PressableScale
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled }}
      style={({ pressed }) => [
        styles.option,
        disabled && styles.optionDisabled,
        pressed && !disabled && styles.optionPressed,
      ]}
    >
      <SelectionMark selected={selected} />
      <View style={{ flex: 1 }}>
        <Text style={styles.optionTitle}>{title}</Text>
        <Text style={styles.optionSubtitle}>{subtitle}</Text>
      </View>
      {note ? (
        <Text style={noteTone === 'success' ? styles.optionFree : styles.optionNote}>{note}</Text>
      ) : null}
    </PressableScale>
  );
}

function SummaryLine({
  label,
  value,
  divided = false,
  valueTone = 'default',
}: {
  label: string;
  value: string;
  divided?: boolean;
  valueTone?: 'default' | 'success';
}) {
  return (
    <View style={[styles.summaryLine, divided && styles.summaryDivided]}>
      <Text style={styles.summaryLabel} numberOfLines={1}>
        {label}
      </Text>
      <Text style={[styles.summaryValue, valueTone === 'success' && { color: colors.success }]}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: spacing.xl, paddingTop: spacing.md, paddingBottom: spacing.xl },
  block: { marginTop: spacing.xl },

  addressCard: { padding: spacing.xl, borderRadius: radius.lg, backgroundColor: colors.surface },
  addressTop: { flexDirection: 'row', gap: spacing.lg },
  addressName: { ...typography.bodyStrong, fontWeight: '600', color: colors.text },
  addressLine: { ...typography.callout, color: colors.textMuted, lineHeight: 23, marginTop: 6 },
  action: { ...typography.calloutStrong, color: colors.primary },

  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md + 2,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg - 2,
  },
  optionPressed: { backgroundColor: colors.surfacePressed },
  optionDisabled: { opacity: 0.5 },
  optionTitle: { ...typography.bodyStrong, color: colors.text },
  optionSubtitle: { ...typography.caption, color: colors.textFaint, marginTop: 3 },
  optionFree: { ...typography.captionStrong, color: colors.success },
  optionNote: { ...typography.caption, color: colors.textFaint },

  summaryCard: { paddingHorizontal: spacing.xl, borderRadius: radius.lg, backgroundColor: colors.surface },
  summaryLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.lg,
    paddingVertical: 13,
  },
  summaryDivided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  summaryLabel: { ...typography.callout, color: colors.textMuted, flex: 1 },
  summaryValue: { ...typography.calloutStrong, color: colors.text },

  footer: { paddingHorizontal: spacing.xl, paddingTop: spacing.lg, paddingBottom: spacing.xl },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: spacing.md + 2,
  },
  totalLabel: { ...typography.callout, color: colors.textMuted },
  skeletonFooter: { paddingHorizontal: 24, marginTop: 32, gap: 16 },
  skeletonButton: { borderRadius: 999 },
  totalValue: { ...typography.title2, color: colors.text },
});
