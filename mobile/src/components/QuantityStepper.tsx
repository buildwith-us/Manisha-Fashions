import { StyleSheet, Text, View } from 'react-native';
import { PressableScale } from './motion';
import { motion } from '../theme/motion';
import { colors, radius, spacing, typography } from '../theme';

/**
 * A filled tinted pill rather than a bordered box. When the cart flags a line
 * for stock, the whole control turns accent-tinted — that is the entire warning
 * treatment, with a sentence of explanation beside it and nothing shouted.
 */
export function QuantityStepper({
  quantity,
  onChange,
  min = 0,
  max = 999,
  disabled = false,
  size = 'sm',
  flagged = false,
}: {
  quantity: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
  /** `lg` is the 54px control that sits beside "Add to cart". */
  size?: 'sm' | 'lg';
  flagged?: boolean;
}) {
  const canDecrease = !disabled && quantity > min;
  const canIncrease = !disabled && quantity < max;
  const large = size === 'lg';

  const ink = flagged ? colors.primary : colors.text;
  const inkDim = flagged ? colors.primaryFaint : colors.textPlaceholder;

  return (
    <View
      style={[
        styles.container,
        large ? styles.containerLarge : styles.containerSmall,
        { backgroundColor: flagged ? colors.primarySoft : colors.background },
      ]}
    >
      <PressableScale
        onPress={() => onChange(quantity - 1)}
        disabled={!canDecrease}
        scaleTo={motion.pressScaleSmall}
        style={[styles.button, large && styles.buttonLarge]}
        accessibilityRole="button"
        accessibilityLabel="Decrease quantity"
      >
        <Text style={[styles.symbol, large && styles.symbolLarge, { color: canDecrease ? ink : inkDim }]}>
          −
        </Text>
      </PressableScale>

      <Text style={[styles.quantity, large && styles.quantityLarge, { color: ink }]}>
        {quantity}
      </Text>

      <PressableScale
        onPress={() => onChange(quantity + 1)}
        disabled={!canIncrease}
        scaleTo={motion.pressScaleSmall}
        style={[styles.button, large && styles.buttonLarge]}
        accessibilityRole="button"
        accessibilityLabel="Increase quantity"
      >
        <Text style={[styles.symbol, large && styles.symbolLarge, { color: canIncrease ? ink : inkDim }]}>
          +
        </Text>
      </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start' },
  containerSmall: { borderRadius: radius.sm },
  containerLarge: { borderRadius: radius.md, height: 54 },
  button: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  buttonLarge: { width: 40, height: 54 },
  symbol: { fontSize: 17, fontWeight: '500' },
  symbolLarge: { fontSize: 20 },
  quantity: {
    ...typography.calloutStrong,
    fontWeight: '600',
    minWidth: 22,
    textAlign: 'center',
    paddingHorizontal: spacing.xs,
  },
  quantityLarge: { ...typography.heading, minWidth: 26 },
});
