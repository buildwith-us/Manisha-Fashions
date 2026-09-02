import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import {
  Button,
  Chip,
  Group,
  KeyboardAwareScrollView,
  Row,
  Screen,
  SectionLabel,
  Toggle,
} from '../../components/ui';
import { Icon } from '../../components/Icon';
import { PressableScale } from '../../components/motion';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { fetchProducts, resetFilters, setFilters } from '../../store/slices/productSlice';
import { colors, radius, shadowSoft, spacing, typography } from '../../theme';
import { paiseToRupeeInput, rupeesToPaise } from '../../utils/money';
import type { ProductFilters } from '../../api/types';

const SORT_OPTIONS: Array<{ value: ProductFilters['sort']; label: string }> = [
  { value: 'newest', label: 'Newest first' },
  { value: 'price_asc', label: 'Price — low to high' },
  { value: 'price_desc', label: 'Price — high to low' },
  { value: 'name_asc', label: 'Name A–Z' },
];

/**
 * PRD 4.2 — filter by price range and category, sort by newest/price.
 * Presented as a sheet: a grabber, one decision per grouped block, and the
 * result count on the confirm button so nothing is applied blind.
 */
export function FiltersScreen() {
  const navigation = useNavigation();
  const dispatch = useAppDispatch();
  const { filters, categories } = useAppSelector((state) => state.product);

  const [sort, setSort] = useState<ProductFilters['sort']>(filters.sort);
  const [category, setCategory] = useState<string | undefined>(filters.category);
  const [minPrice, setMinPrice] = useState(
    filters.minPrice !== undefined ? paiseToRupeeInput(filters.minPrice) : '',
  );
  const [maxPrice, setMaxPrice] = useState(
    filters.maxPrice !== undefined ? paiseToRupeeInput(filters.maxPrice) : '',
  );
  const [inStockOnly, setInStockOnly] = useState(Boolean(filters.inStockOnly));

  const min = minPrice.trim() ? rupeesToPaise(minPrice) : undefined;
  const max = maxPrice.trim() ? rupeesToPaise(maxPrice) : undefined;
  const rangeInvalid = min !== undefined && max !== undefined && min > max;

  const apply = () => {
    if (rangeInvalid) return;
    dispatch(setFilters({ sort, category, minPrice: min, maxPrice: max, inStockOnly }));
    void dispatch(fetchProducts({ page: 1 }));
    navigation.goBack();
  };

  const clear = () => {
    dispatch(resetFilters());
    void dispatch(fetchProducts({ page: 1 }));
    navigation.goBack();
  };

  return (
    <Screen edges={['bottom']}>
      <View style={styles.grabberRow}>
        <View style={styles.grabber} />
      </View>

      <View style={styles.titleRow}>
        <Text style={styles.title}>Filter & sort</Text>
        <PressableScale
          onPress={() => navigation.goBack()}
          hitSlop={10}
          style={styles.close}
          accessibilityRole="button"
          accessibilityLabel="Close"
        >
          <Icon name="close" size={15} color={colors.textMuted} strokeWidth={2.2} />
        </PressableScale>
      </View>

      <KeyboardAwareScrollView contentContainerStyle={styles.scroll}>
        <SectionLabel>Sort by</SectionLabel>
        <Group>
          {SORT_OPTIONS.map((option) => {
            const selected = sort === option.value;
            return (
              <Row
                key={option.value}
                label={option.label}
                tone={selected ? 'default' : 'muted'}
                onPress={() => setSort(option.value)}
                right={
                  selected ? (
                    <Icon name="check" size={18} color={colors.primary} strokeWidth={2.4} />
                  ) : null
                }
              />
            );
          })}
        </Group>

        <View style={styles.block}>
          <SectionLabel>Price range (₹)</SectionLabel>
          <View style={[styles.priceCard, shadowSoft]}>
            <View style={styles.priceRow}>
              <PriceInput label="Minimum" value={minPrice} onChange={setMinPrice} hint="0" />
              <View style={styles.priceDash} />
              <PriceInput label="Maximum" value={maxPrice} onChange={setMaxPrice} hint="Any" />
            </View>
            {rangeInvalid ? (
              <Text style={styles.priceError}>Maximum must be at least the minimum.</Text>
            ) : null}
          </View>
        </View>

        <View style={styles.block}>
          <SectionLabel>Category</SectionLabel>
          <View style={styles.categoryChips}>
            <Chip label="All" active={!category} onPress={() => setCategory(undefined)} />
            {categories.map((item) => (
              <Chip
                key={item.id}
                label={item.name}
                active={category === item.id}
                onPress={() => setCategory(category === item.id ? undefined : item.id)}
              />
            ))}
          </View>
        </View>

        <View style={styles.block}>
          <Group>
            <Row
              label="In stock only"
              detail="Hide sold-out pieces"
              right={<Toggle value={inStockOnly} onValueChange={setInStockOnly} />}
            />
          </Group>
        </View>
      </KeyboardAwareScrollView>

      <View style={styles.footer}>
        <Button label="Reset" onPress={clear} variant="secondary" fullWidth={false} style={styles.reset} />
        <Button label="Show pieces" onPress={apply} disabled={rangeInvalid} style={{ flex: 1 }} />
      </View>
    </Screen>
  );
}

/** The price boxes are the only bare text inputs on this sheet. */
function PriceInput({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  hint: string;
}) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={styles.priceLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={(next) => onChange(next.replace(/[^\d.]/g, ''))}
        placeholder={hint}
        placeholderTextColor={colors.textDisabled}
        keyboardType="numeric"
        style={styles.priceInput}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  grabberRow: { alignItems: 'center', paddingTop: spacing.md + 2, paddingBottom: spacing.sm },
  grabber: { width: 38, height: 5, borderRadius: radius.pill, backgroundColor: colors.borderStrong },

  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
  },
  title: { ...typography.title2, fontSize: 24, color: colors.text },
  close: {
    width: 30,
    height: 30,
    borderRadius: radius.pill,
    backgroundColor: colors.fill,
    alignItems: 'center',
    justifyContent: 'center',
  },

  scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xl },
  block: { marginTop: spacing.xl },

  priceCard: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.xl },
  priceRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.lg },
  // 14px, deliberately off the scale: it optically centres the 1px dash
  // against the two price fields. A scale step either way misaligns it.
  priceDash: { width: 16, height: 1, backgroundColor: colors.borderStrong, marginBottom: 14 },
  priceLabel: { ...typography.tiny, color: colors.textFaint },
  priceInput: { ...typography.bodyStrong, color: colors.text, paddingVertical: spacing.sm },
  priceError: { ...typography.footnote, color: colors.primary, marginTop: spacing.md },

  categoryChips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },

  footer: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
  },
  reset: { width: 110 },
});
