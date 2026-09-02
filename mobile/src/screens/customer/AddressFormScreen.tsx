import { useState } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { ErrorBanner, FieldRow, Group, KeyboardAwareScrollView, Row, Screen, Segmented, Toggle } from '../../components/ui';
import { PressableScale } from '../../components/motion';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { saveAddress } from '../../store/slices/authSlice';
import { colors, spacing, typography } from '../../theme';
import type { RootStackParamList } from '../../navigation/types';

type Route = RouteProp<RootStackParamList, 'AddressForm'>;

const LABELS = [
  { value: 'Home', label: 'Home' },
  { value: 'Work', label: 'Work' },
  { value: 'Other', label: 'Other' },
];

/**
 * Screen 21 — grouped fields, no boxes. Each row is a 12px label over the value
 * itself; the field being typed into carries the accent focus ring, and that is
 * the only accent on the form until something is wrong.
 */
export function AddressFormScreen() {
  const navigation = useNavigation();
  const { params } = useRoute<Route>();
  const dispatch = useAppDispatch();

  const user = useAppSelector((state) => state.auth.user);
  const existing = user?.addresses.find((entry) => entry.id === params?.addressId);

  const [label, setLabel] = useState(existing?.label ?? 'Home');
  const [fullName, setFullName] = useState(existing?.fullName ?? user?.name ?? '');
  const [phone, setPhone] = useState((existing?.phone ?? user?.phone ?? '').replace(/^\+91/, ''));
  const [line1, setLine1] = useState(existing?.line1 ?? '');
  const [line2, setLine2] = useState(existing?.line2 ?? '');
  const [city, setCity] = useState(existing?.city ?? '');
  const [state, setState] = useState(existing?.state ?? '');
  const [pincode, setPincode] = useState(existing?.pincode ?? '');
  const [isDefault, setIsDefault] = useState(existing?.isDefault ?? false);

  const [focused, setFocused] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  const errors = {
    fullName: fullName.trim().length < 2 ? 'Enter the recipient name' : null,
    phone: !/^[6-9]\d{9}$/.test(phone.replace(/\D/g, '')) ? 'Enter a valid 10-digit number' : null,
    line1: line1.trim().length < 4 ? 'Enter the street address' : null,
    city: city.trim().length < 2 ? 'Enter the city' : null,
    state: state.trim().length < 2 ? 'Enter the state' : null,
    pincode: !/^[1-9][0-9]{5}$/.test(pincode) ? 'Enter a valid 6-digit PIN code' : null,
  };
  const firstError = Object.values(errors).find((value) => value !== null) ?? null;

  const handleSave = async () => {
    setTouched(true);
    if (firstError) return;

    setSubmitting(true);
    setError(null);

    const result = await dispatch(
      saveAddress({
        id: params?.addressId,
        input: {
          label,
          fullName: fullName.trim(),
          phone: phone.replace(/\D/g, ''),
          line1: line1.trim(),
          line2: line2.trim() || undefined,
          city: city.trim(),
          state: state.trim(),
          pincode,
          isDefault,
        },
      }),
    );
    setSubmitting(false);

    if (saveAddress.fulfilled.match(result)) {
      navigation.goBack();
    } else {
      setError(typeof result.payload === 'string' ? result.payload : 'Could not save the address.');
    }
  };

  const field = (key: string) => ({ focused: focused === key });

  return (
    <Screen edges={['top']}>
      {/* A sheet bar rather than a push bar: cancel and save flank a centred title. */}
      <View style={styles.bar}>
        <PressableScale onPress={() => navigation.goBack()} hitSlop={10}>
          <Text style={styles.cancel}>Cancel</Text>
        </PressableScale>
        <Text style={styles.barTitle}>{params?.addressId ? 'Edit address' : 'New address'}</Text>
        <PressableScale onPress={handleSave} disabled={submitting} hitSlop={10}>
          <Text style={styles.save}>{submitting ? 'Saving…' : 'Save'}</Text>
        </PressableScale>
      </View>

      {/* Scrolls the focused field above the keyboard. The previous
          KeyboardAvoidingView used behavior={undefined} on Android, where that
          makes the component do nothing at all. */}
      <KeyboardAwareScrollView contentContainerStyle={styles.scroll}>
          {error ? <ErrorBanner message={error} /> : null}

          <Segmented
            options={LABELS}
            value={label}
            onChange={setLabel}
            style={{ marginBottom: spacing.lg }}
          />

          <Group>
            <FieldRow label="Full name" {...field('fullName')}>
              <TextInput
                value={fullName}
                onChangeText={setFullName}
                onFocus={() => setFocused('fullName')}
                onBlur={() => setFocused(null)}
                placeholder="Recipient's name"
                placeholderTextColor={colors.textDisabled}
                autoCapitalize="words"
                style={styles.input}
              />
            </FieldRow>

            <FieldRow label="Mobile number" {...field('phone')}>
              <TextInput
                value={phone}
                onChangeText={(value) => setPhone(value.replace(/\D/g, '').slice(0, 10))}
                onFocus={() => setFocused('phone')}
                onBlur={() => setFocused(null)}
                placeholder="10-digit number"
                placeholderTextColor={colors.textDisabled}
                keyboardType="phone-pad"
                maxLength={10}
                style={styles.input}
              />
            </FieldRow>

            <FieldRow label="Flat / building / street" {...field('line1')}>
              <TextInput
                value={line1}
                onChangeText={setLine1}
                onFocus={() => setFocused('line1')}
                onBlur={() => setFocused(null)}
                placeholder="402 Anand Residency, Ring Road"
                placeholderTextColor={colors.textDisabled}
                style={styles.input}
              />
            </FieldRow>

            <FieldRow label="Area / landmark · optional" {...field('line2')}>
              <TextInput
                value={line2}
                onChangeText={setLine2}
                onFocus={() => setFocused('line2')}
                onBlur={() => setFocused(null)}
                placeholder="Near the textile market"
                placeholderTextColor={colors.textDisabled}
                style={styles.input}
              />
            </FieldRow>

            <View style={styles.splitRow}>
              <View style={styles.splitLeft}>
                <FieldRow label="Pincode" {...field('pincode')}>
                  <TextInput
                    value={pincode}
                    onChangeText={(value) => setPincode(value.replace(/\D/g, '').slice(0, 6))}
                    onFocus={() => setFocused('pincode')}
                    onBlur={() => setFocused(null)}
                    placeholder="395002"
                    placeholderTextColor={colors.textDisabled}
                    keyboardType="number-pad"
                    maxLength={6}
                    style={styles.input}
                  />
                </FieldRow>
              </View>
              <View style={{ flex: 1 }}>
                <FieldRow label="City" {...field('city')}>
                  <TextInput
                    value={city}
                    onChangeText={setCity}
                    onFocus={() => setFocused('city')}
                    onBlur={() => setFocused(null)}
                    placeholder="Surat"
                    placeholderTextColor={colors.textDisabled}
                    autoCapitalize="words"
                    style={styles.input}
                  />
                </FieldRow>
              </View>
            </View>

            <FieldRow label="State" {...field('state')}>
              <TextInput
                value={state}
                onChangeText={setState}
                onFocus={() => setFocused('state')}
                onBlur={() => setFocused(null)}
                placeholder="Gujarat"
                placeholderTextColor={colors.textDisabled}
                autoCapitalize="words"
                style={styles.input}
              />
            </FieldRow>
          </Group>

          {touched && firstError ? <Text style={styles.formError}>{firstError}</Text> : null}

          <View style={{ marginTop: spacing.xl }}>
            <Group>
              <Row
                label="Use as my default address"
                right={<Toggle value={isDefault} onValueChange={setIsDefault} />}
              />
            </Group>
          </View>
      </KeyboardAwareScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  bar: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
  },
  cancel: { ...typography.bodyStrong, color: colors.primary },
  save: { ...typography.bodyStrong, fontWeight: '600', color: colors.primary },
  barTitle: { ...typography.heading, color: colors.text, flex: 1, textAlign: 'center' },

  scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxxl },
  input: { ...typography.row, color: colors.text, paddingVertical: 0, marginTop: 4 },
  splitRow: { flexDirection: 'row' },
  splitLeft: { width: 130, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: colors.border },
  formError: { ...typography.footnote, color: colors.primary, marginTop: spacing.md },
});
