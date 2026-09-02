import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button, ErrorBanner, Input, Screen, Segmented } from '../../components/ui';
import { PressableScale } from '../../components/motion';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import {
  clearError,
  sendOtp,
  setPendingAccountType,
  setPendingApplication,
} from '../../store/slices/authSlice';
// ⚠️ TEMPORARY DEV AUTH — REMOVE BEFORE PRODUCTION (see src/config/devAuth.ts)
import { isDevAuthPhone } from '../../config/devAuth';
import { colors, spacing, typography } from '../../theme';
import type { RootStackParamList } from '../../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Login'>;

/**
 * PRD 4.1 — phone + OTP, no password, with separate Retail and Wholesale
 * signup options on the login screen itself.
 *
 * One focal point: the number field. The logo appears here and on the splash,
 * and nowhere else in the app.
 */
export function LoginScreen() {
  const navigation = useNavigation<Nav>();
  const dispatch = useAppDispatch();
  const { loading, error } = useAppSelector((state) => state.auth);
  const accountType = useAppSelector((state) => state.auth.pendingAccountType);

  const [phone, setPhone] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [gstNumber, setGstNumber] = useState('');
  const [touched, setTouched] = useState(false);

  const digits = phone.replace(/\D/g, '');
  // ⚠️ TEMPORARY DEV AUTH — REMOVE BEFORE PRODUCTION
  // isDevAuthPhone is false unless the bypass flag is on, so production
  // validation is exactly `length === 10 && /^[6-9]/`.
  const phoneValid = digits.length === 10 && (/^[6-9]/.test(digits) || isDevAuthPhone(digits));

  const handleContinue = async () => {
    setTouched(true);
    if (!phoneValid) return;

    // Carried through the OTP step and submitted with the verification call.
    dispatch(
      setPendingApplication(
        accountType === 'wholesale'
          ? {
              businessName: businessName.trim() || undefined,
              gstNumber: gstNumber.trim() || undefined,
            }
          : null,
      ),
    );

    const result = await dispatch(sendOtp({ phone: digits, accountType }));
    if (sendOtp.fulfilled.match(result)) {
      navigation.navigate('Otp');
    }
  };

  return (
    <Screen
      scroll
      keyboardAvoiding
      tone="plain"
      edges={['top', 'bottom']}
      contentStyle={styles.content}
    >
      {/* Sign-in opens over whatever a guest was browsing, so backing out has
          to be possible — it returns them there, still a guest. */}
      {navigation.canGoBack() ? (
        <PressableScale
          onPress={() => navigation.goBack()}
          hitSlop={10}
          accessibilityRole="button"
          style={styles.cancel}
        >
          <Text style={styles.cancelLabel}>Cancel</Text>
        </PressableScale>
      ) : null}

      <Image source={require('../../../assets/logo.jpeg')} style={styles.logo} />

      <Text style={styles.heading}>Sign in</Text>
      <Text style={styles.subheading}>
        No password. We send a one-time code by SMS and keep you signed in.
      </Text>

      {error ? <ErrorBanner message={error} /> : null}

      <View style={styles.segmentBlock}>
        <Segmented
          options={[
            { value: 'retail' as const, label: 'Retail' },
            { value: 'wholesale' as const, label: 'Wholesale' },
          ]}
          value={accountType}
          onChange={(next) => {
            dispatch(setPendingAccountType(next));
            dispatch(clearError());
          }}
          tone="plain"
        />
        <Text style={styles.segmentHint}>
          {accountType === 'retail'
            ? 'Shop at our standard retail prices.'
            : 'Approved by the shop before wholesale pricing unlocks.'}
        </Text>
      </View>

      <Input
        label="Mobile number"
        prefix="+91"
        value={phone}
        onChangeText={(value) => setPhone(value.replace(/\D/g, '').slice(0, 10))}
        placeholder="98765 43210"
        keyboardType="phone-pad"
        autoComplete="tel"
        textContentType="telephoneNumber"
        maxLength={10}
        error={touched && !phoneValid ? 'Enter a valid 10-digit mobile number' : null}
        hint="The 10-digit number registered with the shop."
      />

      {accountType === 'wholesale' ? (
        <>
          <Input
            label="Business name"
            value={businessName}
            onChangeText={setBusinessName}
            placeholder="Your shop or firm name"
            autoCapitalize="words"
          />
          <Input
            label="GST number"
            value={gstNumber}
            onChangeText={(value) => setGstNumber(value.toUpperCase().slice(0, 15))}
            placeholder="24AAAAA0000A1Z5"
            autoCapitalize="characters"
            maxLength={15}
            hint="Optional — speeds up approval. You can add this later."
          />
        </>
      ) : null}

      <View style={{ flex: 1, minHeight: spacing.xxl }} />

      <Button label="Send verification code" onPress={handleContinue} loading={loading} />
      <Text style={styles.legal}>
        By continuing you agree to our terms of service and privacy policy.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, paddingHorizontal: spacing.xxl, paddingTop: spacing.xl },
  cancel: { alignSelf: 'flex-start', paddingVertical: spacing.sm, marginBottom: spacing.md },
  cancelLabel: { ...typography.bodyStrong, color: colors.primary },
  logo: { width: 132, height: 104, resizeMode: 'contain' },
  heading: { ...typography.hero, color: colors.text, lineHeight: 38, marginTop: spacing.xxl },
  subheading: { ...typography.row, color: colors.textMuted, lineHeight: 26, marginTop: spacing.md },

  segmentBlock: { marginTop: spacing.xxxl, marginBottom: spacing.xxl },
  segmentHint: { ...typography.footnote, color: colors.textFaint, marginTop: spacing.md },

  legal: {
    ...typography.tiny,
    fontWeight: '400',
    color: colors.textFaint,
    textAlign: 'center',
    lineHeight: 18,
    marginTop: spacing.xl,
  },
});
