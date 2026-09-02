import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { PressableScale } from '../../components/motion';
import { useNavigation } from '@react-navigation/native';
import {
  EmptyState,
  ErrorBanner,
  Group,
  LoadingView,
  NavBar,
  Screen,
  Toggle,
} from '../../components/ui';
import { productApi } from '../../api/endpoints';
import { ApiError } from '../../api/client';
import { colors, radius, shadow, spacing, typography } from '../../theme';
import type { Category } from '../../api/types';

/**
 * PRD 4.7 — screen 30. Toggle to hide, delete only when empty.
 *
 * The add field is the first card on the screen rather than a form behind a
 * button: adding a category is a two-word job and shouldn't cost a navigation.
 */
export function AdminCategoriesScreen() {
  const navigation = useNavigation();
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setCategories(await productApi.categories(true));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not load categories.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleAdd = async () => {
    if (name.trim().length < 2) return;
    setSaving(true);
    setError(null);
    try {
      await productApi.createCategory({ name: name.trim() });
      setName('');
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not add the category.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (category: Category) => {
    try {
      await productApi.updateCategory(category.id, { isActive: !category.isActive });
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not update the category.');
    }
  };

  const handleDelete = (category: Category) => {
    Alert.alert(`Delete "${category.name}"?`, 'Categories with products cannot be deleted.', [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await productApi.deleteCategory(category.id);
            await load();
          } catch (caught) {
            setError(
              caught instanceof ApiError ? caught.message : 'Could not delete the category.',
            );
          }
        },
      },
    ]);
  };

  if (loading) return <LoadingView variant="list" />;

  const canAdd = name.trim().length >= 2;

  return (
    <Screen edges={['top']}>
      <NavBar title="Categories" onBack={() => navigation.goBack()} />

      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.scroll}
      >
        {error ? <ErrorBanner message={error} /> : null}

        <View style={[styles.addCard, shadow]}>
          <TextInput
            value={name}
            onChangeText={setName}
            onSubmitEditing={handleAdd}
            placeholder="New category"
            placeholderTextColor={colors.textDisabled}
            autoCapitalize="words"
            returnKeyType="done"
            style={styles.addInput}
          />
          <PressableScale onPress={handleAdd} disabled={!canAdd || saving} hitSlop={8}>
            <Text style={[styles.addAction, !canAdd && styles.addActionDisabled]}>
              {saving ? 'Adding…' : 'Add'}
            </Text>
          </PressableScale>
        </View>

        {categories.length === 0 ? (
          <EmptyState
            icon="tag"
            title="No categories yet"
            message="Add one above to start organising products."
          />
        ) : (
          <View style={styles.block}>
            <Group>
              {categories.map((category) => (
                <View key={category.id} style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.name, !category.isActive && styles.nameHidden]}>
                      {category.name}
                    </Text>
                    <Text style={styles.slug}>
                      /{category.slug}
                      {category.isActive ? '' : ' · hidden'}
                    </Text>
                  </View>

                  {!category.isActive ? (
                    <PressableScale onPress={() => handleDelete(category)} hitSlop={8}>
                      <Text style={styles.delete}>Delete</Text>
                    </PressableScale>
                  ) : null}

                  <Toggle
                    value={category.isActive}
                    onValueChange={() => void handleToggle(category)}
                  />
                </View>
              ))}
            </Group>
          </View>
        )}

        <Text style={styles.note}>
          A category that still holds products can't be deleted — hide it instead. Hiding keeps
          existing orders and links intact.
        </Text>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: spacing.xl, paddingTop: spacing.md, paddingBottom: spacing.xxl },
  block: { marginTop: spacing.xl },

  addCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg + 2,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  addInput: { ...typography.row, flex: 1, color: colors.text, paddingVertical: spacing.sm },
  addAction: { ...typography.calloutStrong, color: colors.primary },
  addActionDisabled: { color: colors.textDisabled },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md + 2,
    paddingHorizontal: spacing.lg + 2,
    paddingVertical: spacing.lg,
  },
  name: { ...typography.bodyStrong, color: colors.text },
  nameHidden: { color: colors.textFaint },
  slug: { ...typography.footnote, color: colors.textFaint, marginTop: 2 },
  delete: { ...typography.calloutStrong, color: colors.primary },

  note: {
    ...typography.caption,
    color: colors.textFaint,
    lineHeight: 22,
    marginTop: spacing.lg,
    paddingHorizontal: spacing.xs,
  },
});
