import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Pressable,
  StyleSheet,
  View,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { colors, radius, spacing } from '../theme';
import { motion } from '../theme/motion';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * Motion primitives.
 *
 * Everything here is gated on the OS "reduce motion" setting: with it on, the
 * end state is applied instantly rather than animated. Nothing is *removed* —
 * a skeleton still marks loading, a press still tints — only the movement goes.
 */

/** Tracks the OS reduce-motion switch, including changes while the app is open. */
export function useReduceMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (alive) setReduced(value);
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);

  return reduced;
}

/**
 * A Pressable that scales slightly under the finger.
 *
 * The skill's rule — `transform: scale(0.97)` on `:active` — restated with
 * Animated, because RN has no `:active`. Scale is preferred over the opacity
 * dimming it replaces: a 25% fade reads as "disabled", a 3% scale reads as
 * "listening".
 *
 * Press-in is quicker than release, so the control feels like it catches the
 * finger and settles back rather than lagging behind it.
 */
export function PressableScale({
  children,
  style,
  scaleTo = motion.pressScale,
  disabled,
  ...rest
}: Omit<PressableProps, 'style'> & {
  children: ReactNode;
  /**
   * Accepts Pressable's function form as well as a plain style. Passing the
   * function straight through put a function inside a style array, which React
   * Native discards silently — the element kept its handlers but lost every
   * style it had, so cards collapsed and overflowed. It is resolved here
   * instead.
   */
  style?: StyleProp<ViewStyle> | ((state: { pressed: boolean }) => StyleProp<ViewStyle>);
  /** Override for small circular controls, which need a little more. */
  scaleTo?: number;
}) {
  const reduceMotion = useReduceMotion();
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  const [isPressed, setIsPressed] = useState(false);

  const animate = useCallback(
    (pressed: boolean) => {
      setIsPressed(pressed);
      const duration = pressed ? motion.duration.press : motion.duration.fast;
      Animated.parallel([
        Animated.timing(scale, {
          toValue: pressed ? scaleTo : 1,
          duration,
          easing: motion.easeOut,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: pressed ? motion.pressOpacity : 1,
          duration,
          easing: motion.easeOut,
          useNativeDriver: true,
        }),
      ]).start();
    },
    [opacity, scale, scaleTo],
  );

  // With reduce motion on, keep a static opacity nudge so the press is still
  // acknowledged — the feedback matters more than the movement.
  const animatedStyle = reduceMotion
    ? { opacity }
    : { opacity, transform: [{ scale }] };

  const resolvedStyle = typeof style === 'function' ? style({ pressed: isPressed }) : style;

  return (
    // The Pressable itself is animated rather than an inner wrapper: an extra
    // view would sit between the Pressable and its children and quietly change
    // flex layouts, which makes this unsafe as a drop-in replacement.
    <AnimatedPressable
      disabled={disabled}
      onPressIn={disabled ? undefined : () => animate(true)}
      onPressOut={disabled ? undefined : () => animate(false)}
      style={[resolvedStyle, disabled ? null : animatedStyle]}
      {...rest}
    >
      {children}
    </AnimatedPressable>
  );
}

/**
 * A loading placeholder in the shape of the content it stands in for.
 *
 * Replaces a spinner wherever the result has a known shape. A spinner says
 * "something is happening"; a skeleton says "this is what is arriving, and
 * roughly how much" — which is why it reads as faster at identical load times.
 */
export function Skeleton({
  width,
  height,
  style,
  round = false,
}: {
  width?: number | `${number}%`;
  height: number;
  style?: StyleProp<ViewStyle>;
  round?: boolean;
}) {
  const reduceMotion = useReduceMotion();
  const pulse = useRef(new Animated.Value(0.5)).current;

  useEffect(() => {
    if (reduceMotion) {
      pulse.setValue(0.7);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 700,
          easing: motion.easeOut,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0.5,
          duration: 700,
          easing: motion.easeOut,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reduceMotion]);

  return (
    <Animated.View
      style={[
        styles.skeleton,
        { height, borderRadius: round ? radius.pill : radius.sm },
        width !== undefined && { width },
        { opacity: pulse },
        style,
      ]}
    />
  );
}

/**
 * Fades and lifts a list item in, offset by its position.
 *
 * Only on first mount: FlatList recycles rows, and re-running this on every
 * recycle would make scrolling flicker. The delay is capped so a long list does
 * not leave later items waiting.
 */
export function StaggerItem({
  index,
  children,
  style,
}: {
  index: number;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const reduceMotion = useReduceMotion();
  const progress = useRef(new Animated.Value(0)).current;
  const hasAnimated = useRef(false);

  useEffect(() => {
    if (hasAnimated.current) return;
    hasAnimated.current = true;

    if (reduceMotion) {
      progress.setValue(1);
      return;
    }

    const delay = Math.min(index, motion.staggerMaxIndex) * motion.stagger;
    Animated.timing(progress, {
      toValue: 1,
      duration: motion.duration.base,
      delay,
      easing: motion.easeOut,
      useNativeDriver: true,
    }).start();
  }, [index, progress, reduceMotion]);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress,
          transform: [
            {
              // A short lift, not a slide — the row is arriving, not travelling.
              translateY: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [8, 0],
              }),
            },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

/** A product-card shaped skeleton, for the catalogue grid. */
export function ProductCardSkeleton() {
  return (
    <View style={styles.cardSkeleton}>
      <Skeleton height={168} style={styles.cardSkeletonImage} />
      <Skeleton height={15} width="80%" style={{ marginTop: spacing.md }} />
      <Skeleton height={13} width="45%" style={{ marginTop: spacing.sm }} />
    </View>
  );
}

/**
 * A section-label-plus-card skeleton, for the grouped blocks that detail
 * screens are built from. `rows` should match the real block so the placeholder
 * is the same height as what replaces it — a skeleton that resizes on load is
 * worse than a spinner, because it promises the wrong shape.
 */
export function BlockSkeleton({ rows = 2, label = true }: { rows?: number; label?: boolean }) {
  return (
    <View style={styles.block}>
      {label ? <Skeleton height={12} width="28%" style={styles.blockLabel} /> : null}
      <View style={styles.blockCard}>
        {Array.from({ length: rows }).map((_, index) => (
          <View key={index} style={styles.blockRow}>
            <Skeleton height={14} width={index % 2 === 0 ? '55%' : '40%'} />
            <Skeleton height={14} width={48} />
          </View>
        ))}
      </View>
    </View>
  );
}

/** A grouped-row shaped skeleton, for list screens. */
export function ListRowSkeleton() {
  return (
    <View style={styles.rowSkeleton}>
      <Skeleton height={56} width={56} />
      <View style={styles.rowSkeletonBody}>
        <Skeleton height={15} width="70%" />
        <Skeleton height={13} width="40%" style={{ marginTop: spacing.sm }} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  skeleton: { backgroundColor: colors.fill, overflow: 'hidden' },
  cardSkeleton: { flex: 1, padding: spacing.sm },
  cardSkeletonImage: { borderRadius: radius.lg },
  rowSkeleton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  rowSkeletonBody: { flex: 1 },
  block: { paddingHorizontal: spacing.xl, marginTop: spacing.xl },
  blockLabel: { marginBottom: spacing.md, marginLeft: spacing.xs },
  blockCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
  },
  blockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.lg,
  },
});
