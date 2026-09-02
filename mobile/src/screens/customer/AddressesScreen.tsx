import { useEffect } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  Button,
  EmptyState,
  Group,
  NavBar,
  Screen,
  SelectionMark,
} from '../../components/ui';
import { Icon } from '../../components/Icon';
import { PressableScale } from '../../components/motion';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { deleteAddress, fetchAddresses, saveAddress } from '../../store/slices/authSlice';
import { colors, radius, shadowSoft, spacing, typography } from '../../theme';
import type { RootStackParamList } from '../../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Addresses'>;
type Route = RouteProp<RootStackParamList, 'Addresses'>;

/**
 * PRD 4.3 — add / edit / select delivery address. Selection is a checkmark on
 * the row, not a highlighted card.
 */
export function AddressesScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const dispatch = useAppDispatch();
  const addresses = useAppSelector((state) => state.auth.user?.addresses ?? []);

  const selectMode = route.params?.selectMode ?? false;

  useEffect(() => {
    void dispatch(fetchAddresses());
  }, [dispatch]);

  const handleSelect = async (id: string) => {
    const address = addresses.find((entry) => entry.id === id);
    if (!address || address.isDefault) return;
    await dispatch(saveAddress({ id, input: { ...address, isDefault: true } }));
  };

  const handleDelete = (id: string) => {
    Alert.alert('Remove this address?', 'You can add it again later.', [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => void dispatch(deleteAddress(id)),
      },
    ]);
  };

  if (addresses.length === 0) {
    return (
      <Screen edges={['top']}>
        <NavBar title="Delivery address" onBack={() => navigation.goBack()} />
        <EmptyState
          icon="mapPin"
          title="No saved addresses"
          message="Add a delivery address to check out faster next time."
          action={
            <Button
              label="Add an address"
              onPress={() => navigation.navigate('AddressForm')}
              fullWidth={false}
            />
          }
        />
      </Screen>
    );
  }

  return (
    <Screen edges={['top']}>
      <NavBar title="Delivery address" onBack={() => navigation.goBack()} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <Group>
          {addresses.map((address) => (
            <PressableScale
              key={address.id}
              onPress={() => void handleSelect(address.id)}
              accessibilityRole="radio"
              accessibilityState={{ selected: address.isDefault }}
              style={styles.row}
            >
              <SelectionMark selected={address.isDefault} />
              <View style={{ flex: 1 }}>
                <View style={styles.nameRow}>
                  <Text style={styles.name}>{address.fullName}</Text>
                  <View style={styles.labelPill}>
                    <Text style={styles.labelText}>{address.label}</Text>
                  </View>
                </View>
                <Text style={styles.line}>
                  {address.line1}
                  {address.line2 ? `, ${address.line2}` : ''}
                  {'\n'}
                  {address.city}, {address.state} {address.pincode}
                </Text>
                <Text style={styles.line}>{address.phone}</Text>

                <View style={styles.actions}>
                  <PressableScale
                    onPress={() => navigation.navigate('AddressForm', { addressId: address.id })}
                    hitSlop={8}
                  >
                    <Text style={styles.action}>Edit</Text>
                  </PressableScale>
                  <PressableScale onPress={() => handleDelete(address.id)} hitSlop={8}>
                    <Text style={[styles.action, styles.actionQuiet]}>Delete</Text>
                  </PressableScale>
                </View>
              </View>
            </PressableScale>
          ))}
        </Group>

        <PressableScale
          onPress={() => navigation.navigate('AddressForm')}
          accessibilityRole="button"
          style={[styles.addRow, shadowSoft]}
        >
          <Icon name="plus" size={20} color={colors.primary} />
          <Text style={styles.addLabel}>Add a new address</Text>
        </PressableScale>
      </ScrollView>

      {selectMode ? (
        <View style={styles.footer}>
          <Button label="Deliver here" onPress={() => navigation.goBack()} />
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: spacing.xl, paddingTop: spacing.md, paddingBottom: spacing.xl },

  row: { flexDirection: 'row', gap: spacing.md + 2, padding: spacing.xl },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  name: { ...typography.bodyStrong, fontWeight: '600', color: colors.text },
  labelPill: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.background,
  },
  labelText: { ...typography.tiny, color: colors.textMuted },
  line: { ...typography.callout, color: colors.textMuted, lineHeight: 23, marginTop: 6 },
  actions: { flexDirection: 'row', gap: spacing.xl, marginTop: spacing.md },
  action: { ...typography.calloutStrong, color: colors.primary },
  actionQuiet: { color: colors.textFaint },

  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.xl,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg + 2,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  addLabel: { ...typography.bodyStrong, color: colors.primary },

  footer: { paddingHorizontal: spacing.xl, paddingTop: spacing.lg, paddingBottom: spacing.xl },
});
