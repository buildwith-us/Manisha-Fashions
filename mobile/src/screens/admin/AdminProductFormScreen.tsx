import { useEffect, useState } from 'react';
import {
  Pressable,
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import {
  Button,
  ErrorBanner,
  FieldRow,
  Group,
  ImageSlots,
  KeyboardAwareScrollView,
  Row,
  Screen,
  SectionLabel,
  Segmented,
  SelectRow,
  SplitRow,
  Toggle,
} from '../../components/ui';
import { Icon } from '../../components/Icon';
import { BlockSkeleton, PressableScale } from '../../components/motion';
import { productApi } from '../../api/endpoints';
import { ApiError } from '../../api/client';
import { PERMISSIONS, useAppSelector, usePermission } from '../../store/hooks';
import { colors, radius, spacing, typography } from '../../theme';
import { paiseToRupeeInput, rupeesToPaise } from '../../utils/money';
import type { RootStackParamList } from '../../navigation/types';
import type { Category, ProductVisibility } from '../../api/types';

type Route = RouteProp<RootStackParamList, 'AdminProductForm'>;

const MAX_IMAGES = 10;

/**
 * PRD 4.7 — screens 25 and 33. Add / edit a product.
 *
 * Both prices are required and both are typed by hand: there is deliberately no
 * derived default, no "x% off retail" helper, and no fallback if the wholesale
 * field is left empty. An empty wholesale price fails validation rather than
 * quietly becoming a number.
 *
 * PRD 8.9 — a staff account can edit everything except the two price fields,
 * which are read-only here and refused by the server regardless.
 */
export function AdminProductFormScreen() {
  const navigation = useNavigation();
  const { params } = useRoute<Route>();
  const productId = params?.productId;
  const isEdit = Boolean(productId);

  const canManagePrice = usePermission(PERMISSIONS.PRODUCT_PRICE_MANAGE);
  const categories = useAppSelector((state) => state.product.categories);

  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [focused, setFocused] = useState<string | null>(null);
  const [pickingCategory, setPickingCategory] = useState(false);

  const [categoryOptions, setCategoryOptions] = useState<Category[]>(categories);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<string | undefined>(undefined);
  const [retailPrice, setRetailPrice] = useState('');
  const [wholesalePrice, setWholesalePrice] = useState('');
  const [stock, setStock] = useState('0');
  const [sku, setSku] = useState('');
  const [tags, setTags] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [isActive, setIsActive] = useState(true);
  const [visibility, setVisibility] = useState<ProductVisibility>('both');

  useEffect(() => {
    productApi
      .categories(true)
      .then(setCategoryOptions)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!productId) return;

    productApi
      .detail(productId)
      .then((product) => {
        setName(product.name);
        setDescription(product.description);
        setCategory(product.category?.id);
        setRetailPrice(paiseToRupeeInput(product.retailPrice));
        setWholesalePrice(
          product.wholesalePrice !== undefined ? paiseToRupeeInput(product.wholesalePrice) : '',
        );
        setStock(String(product.stock));
        setSku(product.sku ?? '');
        setTags(product.tags.join(', '));
        setImages(product.images);
        setIsActive(product.isActive);
        setVisibility(product.visibility ?? 'both');
      })
      .catch((caught: unknown) => {
        setError(caught instanceof ApiError ? caught.message : 'Could not load this product.');
      })
      .finally(() => setLoading(false));
  }, [productId]);

  const retailPaise = rupeesToPaise(retailPrice);
  const wholesalePaise = rupeesToPaise(wholesalePrice);

  const errors = {
    name: name.trim().length < 2 ? 'Enter a product name' : null,
    description: description.trim().length < 1 ? 'Enter a description' : null,
    category: !category ? 'Choose a category' : null,
    retailPrice: !retailPrice.trim() || retailPaise <= 0 ? 'Enter the retail price' : null,
    wholesalePrice:
      canManagePrice && (!wholesalePrice.trim() || wholesalePaise <= 0)
        ? 'Enter the wholesale price'
        : canManagePrice && wholesalePaise > retailPaise
          ? 'Wholesale price cannot exceed retail price'
          : null,
    stock: Number.isNaN(Number(stock)) || Number(stock) < 0 ? 'Enter a valid stock count' : null,
  };
  const isValid = Object.values(errors).every((value) => value === null);
  const firstError = Object.values(errors).find((value) => value !== null) ?? null;

  const handlePickImages = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission needed', 'Allow photo access to upload product images.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: Math.max(1, MAX_IMAGES - images.length),
      quality: 0.85,
    });
    if (result.canceled || result.assets.length === 0) return;

    setUploading(true);
    setError(null);
    try {
      const uploaded = await productApi.uploadImages(
        result.assets.map((asset, index) => ({
          uri: asset.uri,
          name: asset.fileName ?? `product-${Date.now()}-${index}.jpg`,
          type: asset.mimeType ?? 'image/jpeg',
        })),
      );
      setImages((current) => [...current, ...uploaded.map((entry) => entry.url)].slice(0, MAX_IMAGES));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not upload the images.');
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    setTouched(true);
    if (!isValid) return;

    setSaving(true);
    setError(null);

    const tagList = tags
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);

    try {
      if (isEdit && productId) {
        await productApi.update(productId, {
          name: name.trim(),
          description: description.trim(),
          category,
          images,
          stock: Number(stock),
          sku: sku.trim() || undefined,
          tags: tagList,
          isActive,
          visibility,
          // Price fields are only sent when this account may change them —
          // sending them as staff would be a guaranteed 403.
          ...(canManagePrice ? { retailPrice: retailPaise, wholesalePrice: wholesalePaise } : {}),
        });
      } else {
        await productApi.create({
          name: name.trim(),
          description: description.trim(),
          category: category as string,
          images,
          retailPrice: retailPaise,
          wholesalePrice: wholesalePaise,
          stock: Number(stock),
          sku: sku.trim() || undefined,
          tags: tagList,
          isActive,
          visibility,
        });
      }
      navigation.goBack();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not save the product.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = () => {
    if (!productId) return;
    Alert.alert('Delete this product?', 'This cannot be undone.', [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await productApi.remove(productId);
            navigation.goBack();
          } catch (caught) {
            setError(caught instanceof ApiError ? caught.message : 'Could not delete the product.');
          }
        },
      },
    ]);
  };

  if (loading) {
    return (
      <Screen edges={['top', 'bottom']}>
        <BlockSkeleton rows={4} />
        <BlockSkeleton rows={3} />
      </Screen>
    );
  }

  const categoryName = categoryOptions.find((option) => option.id === category)?.name;

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={styles.bar}>
        <PressableScale onPress={() => navigation.goBack()} hitSlop={10}>
          <Text style={styles.cancel}>Cancel</Text>
        </PressableScale>
        <Text style={styles.barTitle}>{isEdit ? 'Edit product' : 'New product'}</Text>
        <PressableScale onPress={handleSave} disabled={saving || !isValid} hitSlop={10}>
          <Text style={[styles.save, !isValid && styles.saveDisabled]}>
            {saving ? 'Saving…' : 'Save'}
          </Text>
        </PressableScale>
      </View>

      {/* Same fix as the address form: the old behavior={undefined} made this
          a no-op on Android, so the lower fields sat under the keyboard. */}
      <KeyboardAwareScrollView contentContainerStyle={styles.scroll}>
          {error ? <ErrorBanner message={error} /> : null}

          {images.length > 0 ? <SectionLabel>Images · first is the cover</SectionLabel> : null}
          <ImageSlots
            uris={images}
            onAdd={handlePickImages}
            onRemove={(uri) => setImages((current) => current.filter((entry) => entry !== uri))}
            max={MAX_IMAGES}
            busy={uploading}
          />

          <View style={styles.block}>
            <Group>
              <FieldRow label="Name" focused={focused === 'name'}>
                <TextInput
                  value={name}
                  onChangeText={setName}
                  onFocus={() => setFocused('name')}
                  onBlur={() => setFocused(null)}
                  placeholder="e.g. Antique Gold Bangle"
                  placeholderTextColor={colors.textDisabled}
                  style={styles.input}
                />
              </FieldRow>

              <SplitRow>
                <SelectRow
                  label="Category"
                  value={categoryName}
                  placeholder="Choose"
                  onPress={() => setPickingCategory(true)}
                  style={{ flex: 1 }}
                />
                <FieldRow label="Stock" focused={focused === 'stock'} style={styles.stockCell}>
                  <TextInput
                    value={stock}
                    onChangeText={(value) => setStock(value.replace(/\D/g, ''))}
                    onFocus={() => setFocused('stock')}
                    onBlur={() => setFocused(null)}
                    keyboardType="number-pad"
                    placeholder="0"
                    placeholderTextColor={colors.textDisabled}
                    style={styles.input}
                  />
                </FieldRow>
              </SplitRow>

              {/* Both prices are entered by hand — see the file header. */}
              <SplitRow>
                <FieldRow
                  label="Retail price"
                  focused={focused === 'retailPrice'}
                  style={{ flex: 1 }}
                >
                  <View style={styles.priceCell}>
                    <Text style={styles.rupee}>₹</Text>
                    <TextInput
                      value={retailPrice}
                      onChangeText={setRetailPrice}
                      onFocus={() => setFocused('retailPrice')}
                      onBlur={() => setFocused(null)}
                      keyboardType="decimal-pad"
                      placeholder="0"
                      placeholderTextColor={colors.textDisabled}
                      editable={canManagePrice}
                      style={styles.priceInput}
                    />
                  </View>
                </FieldRow>
                <FieldRow
                  label="Wholesale price"
                  focused={focused === 'wholesalePrice'}
                  style={{ flex: 1 }}
                >
                  <View style={styles.priceCell}>
                    <Text style={[styles.rupee, styles.tradeInk]}>₹</Text>
                    <TextInput
                      value={wholesalePrice}
                      onChangeText={setWholesalePrice}
                      onFocus={() => setFocused('wholesalePrice')}
                      onBlur={() => setFocused(null)}
                      keyboardType="decimal-pad"
                      placeholder="0"
                      placeholderTextColor={colors.textDisabled}
                      editable={canManagePrice}
                      style={[styles.priceInput, styles.tradeInk]}
                    />
                  </View>
                </FieldRow>
              </SplitRow>

              <FieldRow label="Description" focused={focused === 'description'}>
                <TextInput
                  value={description}
                  onChangeText={setDescription}
                  onFocus={() => setFocused('description')}
                  onBlur={() => setFocused(null)}
                  placeholder="Materials, weight, what's included"
                  placeholderTextColor={colors.textDisabled}
                  multiline
                  style={styles.textarea}
                />
              </FieldRow>

              <Row
                label="Visible in shop"
                detail="Hidden products keep their orders"
                right={<Toggle value={isActive} onValueChange={setIsActive} />}
              />
            </Group>

            {/* Deliberately separate from "Visible in shop": that takes a
                product off sale entirely, this decides which customers see it
                while it is on sale. */}
            <SectionLabel>Sell to</SectionLabel>
            <Group>
              <View style={styles.storefrontRow}>
                <Segmented
                  value={visibility}
                  onChange={setVisibility}
                  options={[
                    { value: 'both', label: 'Everyone' },
                    { value: 'retail', label: 'Retail' },
                    { value: 'wholesale', label: 'Trade' },
                  ]}
                />
                <Text style={styles.storefrontHint}>
                  {visibility === 'both'
                    ? 'Shown to retail customers and approved trade buyers.'
                    : visibility === 'retail'
                      ? 'Retail customers only — hidden from approved trade buyers.'
                      : 'Approved trade buyers only — hidden from retail customers.'}
                </Text>
              </View>
            </Group>

            {!canManagePrice ? (
              <Text style={styles.permissionNote}>
                Only an admin can change pricing. Everything else on this form is yours to edit.
              </Text>
            ) : null}
          </View>

          <View style={styles.block}>
            <SectionLabel>Optional</SectionLabel>
            <Group>
              <FieldRow label="SKU" focused={focused === 'sku'}>
                <TextInput
                  value={sku}
                  onChangeText={(value) => setSku(value.toUpperCase())}
                  onFocus={() => setFocused('sku')}
                  onBlur={() => setFocused(null)}
                  placeholder="MF-NK-114"
                  placeholderTextColor={colors.textDisabled}
                  autoCapitalize="characters"
                  style={styles.input}
                />
              </FieldRow>
              <FieldRow label="Tags · comma separated, searchable" focused={focused === 'tags'}>
                <TextInput
                  value={tags}
                  onChangeText={setTags}
                  onFocus={() => setFocused('tags')}
                  onBlur={() => setFocused(null)}
                  placeholder="kundan, bridal, gold-plated"
                  placeholderTextColor={colors.textDisabled}
                  autoCapitalize="none"
                  style={styles.input}
                />
              </FieldRow>
            </Group>
          </View>
      </KeyboardAwareScrollView>

      <View style={styles.footer}>
        <Button
          label={isEdit ? 'Save changes' : 'Publish to shop'}
          onPress={handleSave}
          loading={saving}
          disabled={!isValid}
        />
        {!isValid ? (
          <Text style={styles.footerHint}>
            {touched && firstError
              ? firstError
              : 'Name, category, description and both prices are needed before publishing.'}
          </Text>
        ) : null}
        {isEdit && canManagePrice ? (
          <PressableScale onPress={handleDelete} style={styles.delete} accessibilityRole="button">
            <Text style={styles.deleteLabel}>Delete product</Text>
          </PressableScale>
        ) : null}
      </View>

      <CategoryPicker
        visible={pickingCategory}
        options={categoryOptions}
        selected={category}
        onSelect={(id) => {
          setCategory(id);
          setPickingCategory(false);
        }}
        onClose={() => setPickingCategory(false)}
      />
    </Screen>
  );
}

/**
 * A sheet rather than a native picker: the same grabber, grouped rows and
 * accent checkmark used everywhere else a choice is made in this app.
 */
function CategoryPicker({
  visible,
  options,
  selected,
  onSelect,
  onClose,
}: {
  visible: boolean;
  options: Category[];
  selected?: string;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/* Plain Pressable: the scrim is a dismiss target, not a control —
          scaling the dimming layer would read as a glitch. */}
      <Pressable style={styles.scrim} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.grabberRow}>
          <View style={styles.grabber} />
        </View>
        <View style={styles.sheetTitleRow}>
          <Text style={styles.sheetTitle}>Category</Text>
          <PressableScale onPress={onClose} hitSlop={10} style={styles.sheetClose}>
            <Icon name="close" size={15} color={colors.textMuted} strokeWidth={2.2} />
          </PressableScale>
        </View>

        <ScrollView contentContainerStyle={styles.sheetScroll} showsVerticalScrollIndicator={false}>
          <Group>
            {options.map((option) => (
              <Row
                key={option.id}
                label={option.name}
                tone={selected === option.id ? 'default' : 'muted'}
                onPress={() => onSelect(option.id)}
                right={
                  selected === option.id ? (
                    <Icon name="check" size={18} color={colors.primary} strokeWidth={2.4} />
                  ) : null
                }
              />
            ))}
          </Group>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  bar: { height: 52, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.xl },
  cancel: { ...typography.bodyStrong, color: colors.primary },
  barTitle: { ...typography.heading, color: colors.text, flex: 1, textAlign: 'center' },
  save: { ...typography.bodyStrong, fontWeight: '600', color: colors.primary },
  saveDisabled: { color: colors.textDisabled, fontWeight: '500' },

  scroll: { paddingHorizontal: spacing.xl, paddingTop: spacing.md, paddingBottom: spacing.xl },
  block: { marginTop: spacing.xl },

  input: { ...typography.row, color: colors.text, paddingVertical: 0, marginTop: 4 },
  textarea: {
    ...typography.body,
    color: colors.textMuted,
    lineHeight: 25,
    marginTop: 6,
    paddingVertical: 0,
    minHeight: 72,
    textAlignVertical: 'top',
  },
  stockCell: { width: 120 },
  priceCell: { flexDirection: 'row', alignItems: 'baseline', marginTop: 4 },
  rupee: { fontSize: 19, fontWeight: '500', color: colors.text },
  priceInput: { flex: 1, fontSize: 19, fontWeight: '500', color: colors.text, paddingVertical: 0 },
  tradeInk: { color: colors.primary },
  storefrontRow: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.sm },
  storefrontHint: { ...typography.footnote, color: colors.textFaint },
  permissionNote: { ...typography.footnote, color: colors.warning, marginTop: spacing.md },

  footer: { paddingHorizontal: spacing.xl, paddingTop: spacing.lg, paddingBottom: spacing.xl },
  footerHint: {
    ...typography.footnote,
    color: colors.textFaint,
    textAlign: 'center',
    lineHeight: 19,
    marginTop: spacing.md,
  },
  delete: { height: 50, alignItems: 'center', justifyContent: 'center', marginTop: spacing.xs },
  deleteLabel: { ...typography.bodyStrong, color: colors.primary },

  scrim: { flex: 1, backgroundColor: colors.scrim },
  sheet: {
    maxHeight: '72%',
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
  },
  grabberRow: { alignItems: 'center', paddingTop: spacing.md + 2, paddingBottom: spacing.sm },
  grabber: { width: 38, height: 5, borderRadius: radius.pill, backgroundColor: colors.borderStrong },
  sheetTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
  },
  sheetTitle: { ...typography.title, fontSize: 24, color: colors.text },
  sheetClose: {
    width: 30,
    height: 30,
    borderRadius: radius.pill,
    backgroundColor: colors.fill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetScroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxxl },
});
