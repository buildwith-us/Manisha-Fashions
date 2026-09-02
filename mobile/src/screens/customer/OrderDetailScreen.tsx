import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { BlockSkeleton, PressableScale } from '../../components/motion';
import { Image } from 'expo-image';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import {
  EmptyState,
  Group,
  NavBar,
  Screen,
  SectionLabel,
  StatusText,
} from '../../components/ui';
import { orderApi } from '../../api/endpoints';
import { useAppDispatch } from '../../store/hooks';
import { cancelOrder } from '../../store/slices/cartSlice';
import { colors, orderStatusStyle, radius, shadow, spacing, typography } from '../../theme';
import { formatPaise } from '../../utils/money';
import type { RootStackParamList } from '../../navigation/types';
import type { Order, OrderStatus } from '../../api/types';

type Route = RouteProp<RootStackParamList, 'OrderDetail'>;

const TIMELINE: OrderStatus[] = ['placed', 'processing', 'shipped', 'delivered'];

const TIMELINE_HINT: Record<string, string> = {
  placed: 'Payment verified',
  processing: 'Packed at the shop',
  shipped: 'Courier and tracking number',
  delivered: 'On its way to you',
};

/**
 * PRD 4.5 — itemised breakdown at price-at-time-of-order, a status timeline,
 * and cancellation while the order is still "placed". Cancel stays quiet until
 * it is the thing you came for.
 */
export function OrderDetailScreen() {
  const { params } = useRoute<Route>();
  const navigation = useNavigation();
  const dispatch = useAppDispatch();

  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);

  const load = useCallback(async () => {
    try {
      setOrder(await orderApi.detail(params.orderId));
    } catch {
      setOrder(null);
    } finally {
      setLoading(false);
    }
  }, [params.orderId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCancel = () => {
    Alert.alert(
      'Cancel this order?',
      'This cannot be undone. Your items will be returned to stock.',
      [
        { text: 'Keep order', style: 'cancel' },
        {
          text: 'Cancel order',
          style: 'destructive',
          onPress: async () => {
            setCancelling(true);
            const result = await dispatch(
              cancelOrder({ orderId: params.orderId, reason: 'Cancelled by customer' }),
            );
            setCancelling(false);

            if (cancelOrder.fulfilled.match(result)) {
              setOrder(result.payload);
            } else {
              Alert.alert(
                'Could not cancel',
                typeof result.payload === 'string' ? result.payload : 'Please try again.',
              );
            }
          },
        },
      ],
    );
  };

  // Keeps the nav bar: a bare LoadingView left no way back while it loaded.
  if (loading) {
    return (
      <Screen edges={['top']}>
        <NavBar onBack={() => navigation.goBack()} />
        <BlockSkeleton rows={3} />
        <BlockSkeleton rows={2} />
        <BlockSkeleton rows={3} />
      </Screen>
    );
  }
  if (!order) {
    return (
      <Screen>
        <EmptyState icon="info" title="Order not found" message="We could not load this order." />
      </Screen>
    );
  }

  const status = orderStatusStyle[order.orderStatus];
  const cancelled = order.orderStatus === 'cancelled';
  const currentStep = TIMELINE.indexOf(order.orderStatus);

  return (
    <Screen edges={['top']}>
      <NavBar
        title={order.orderNumber}
        onBack={() => navigation.goBack()}
        right={<StatusText label={status.label} color={status.fg} />}
      />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {cancelled ? (
          <View style={[styles.card, shadow]}>
            <Text style={styles.cancelledTitle}>Order cancelled</Text>
            <Text style={styles.cancelledNote}>
              {order.statusHistory.find((event) => event.status === 'cancelled')?.note ??
                'Your items were returned to stock.'}
            </Text>
          </View>
        ) : (
          <View style={[styles.card, shadow]}>
            {TIMELINE.map((step, index) => {
              const reached = index <= currentStep;
              const event = order.statusHistory.find((entry) => entry.status === step);
              return (
                <View key={step} style={styles.step}>
                  <View style={styles.stepRail}>
                    <View style={[styles.stepDot, reached && styles.stepDotReached]} />
                    {index < TIMELINE.length - 1 ? (
                      <View
                        style={[styles.stepLine, index < currentStep && styles.stepLineDone]}
                      />
                    ) : null}
                  </View>
                  <View
                    style={[
                      styles.stepBody,
                      index === TIMELINE.length - 1 && { paddingBottom: 0 },
                    ]}
                  >
                    <Text style={[styles.stepTitle, !reached && styles.stepTitleQuiet]}>
                      {orderStatusStyle[step].label}
                    </Text>
                    <Text style={styles.stepDetail}>
                      {event
                        ? new Date(event.at).toLocaleString('en-IN', {
                            day: 'numeric',
                            month: 'short',
                            hour: 'numeric',
                            minute: '2-digit',
                          })
                        : TIMELINE_HINT[step]}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        <View style={styles.block}>
          <SectionLabel>Items · price at order</SectionLabel>
          <Group>
            {order.items.map((item, index) => (
              <View key={`${item.productId}-${index}`} style={styles.itemRow}>
                {item.image ? (
                  <Image
                    source={item.image}
                    style={styles.thumb}
                    contentFit="cover"
                    cachePolicy="memory-disk"
                  />
                ) : (
                  <View style={styles.thumb} />
                )}
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemName} numberOfLines={2}>
                    {item.name}
                  </Text>
                  {/* PRD 8.2 — the price captured at order time, not today's price. */}
                  <Text style={styles.itemMeta}>
                    {item.quantity} × {formatPaise(item.priceAtOrder)}
                    {item.priceTier === 'wholesale' ? ' · wholesale' : ''}
                  </Text>
                </View>
                <Text style={styles.itemTotal}>{formatPaise(item.lineTotal)}</Text>
              </View>
            ))}
          </Group>
        </View>

        <View style={styles.block}>
          <SectionLabel>Delivered to</SectionLabel>
          <Group padded>
            <Text style={styles.addressName}>{order.shippingAddress.fullName}</Text>
            <Text style={styles.addressLine}>
              {order.shippingAddress.line1}
              {order.shippingAddress.line2 ? `, ${order.shippingAddress.line2}` : ''}
              {'\n'}
              {order.shippingAddress.city}, {order.shippingAddress.state}{' '}
              {order.shippingAddress.pincode}
            </Text>
            <Text style={styles.addressLine}>{order.shippingAddress.phone}</Text>
          </Group>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>
            {order.paymentStatus === 'paid' ? 'Paid' : 'Payable'} ·{' '}
            {order.paymentMethod === 'cod' ? 'On delivery' : 'Online'}
          </Text>
          <Text style={styles.totalValue}>{formatPaise(order.totalAmount)}</Text>
        </View>

        {order.cancellable ? (
          <PressableScale onPress={handleCancel} disabled={cancelling} style={styles.cancel}>
            <Text style={styles.cancelLabel}>
              {cancelling ? 'Cancelling…' : 'Cancel order'}
            </Text>
          </PressableScale>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: spacing.xl, paddingTop: spacing.md, paddingBottom: spacing.xl },
  block: { marginTop: spacing.xl },

  card: { padding: spacing.xl, borderRadius: radius.xl, backgroundColor: colors.surface },
  cancelledTitle: { ...typography.bodyStrong, fontWeight: '600', color: colors.text },
  cancelledNote: { ...typography.callout, color: colors.textMuted, lineHeight: 23, marginTop: 6 },

  step: { flexDirection: 'row', gap: spacing.lg },
  stepRail: { alignItems: 'center', paddingTop: 4 },
  stepDot: {
    width: 10,
    height: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.borderStrong,
  },
  stepDotReached: { backgroundColor: colors.primary },
  stepLine: { width: 2, flex: 1, backgroundColor: colors.fill, marginVertical: 6 },
  stepLineDone: { backgroundColor: colors.primary },
  stepBody: { flex: 1, paddingBottom: spacing.xl },
  stepTitle: { ...typography.bodyStrong, fontWeight: '600', color: colors.text },
  stepTitleQuiet: { color: colors.textFaint },
  stepDetail: { ...typography.caption, color: colors.textFaint, marginTop: 3 },

  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md + 2,
    paddingHorizontal: spacing.lg + 2,
    paddingVertical: spacing.md + 2,
  },
  thumb: { width: 44, height: 44, borderRadius: 10, backgroundColor: colors.background },
  itemName: { ...typography.calloutStrong, color: colors.text },
  itemMeta: { ...typography.footnote, color: colors.textFaint, marginTop: 2 },
  itemTotal: { ...typography.calloutStrong, color: colors.text },

  addressName: { ...typography.bodyStrong, fontWeight: '600', color: colors.text },
  addressLine: { ...typography.callout, color: colors.textMuted, lineHeight: 23, marginTop: 6 },

  footer: { paddingHorizontal: spacing.xl, paddingTop: spacing.lg, paddingBottom: spacing.xl },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  totalLabel: { ...typography.callout, color: colors.textMuted },
  totalValue: { ...typography.title, fontSize: 24, color: colors.text },
  cancel: { height: 52, alignItems: 'center', justifyContent: 'center', marginTop: spacing.md },
  cancelLabel: { ...typography.bodyStrong, color: colors.primary },
});
