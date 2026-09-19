import { useCallback, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button, ErrorBanner, Input, Screen, Segmented } from '../../components/ui';
import { GoogleButton } from '../../components/GoogleButton';
import { PressableScale } from '../../components/motion';
import { useGoogleSignIn, type GoogleSignInOutcome } from '../../hooks/useGoogleSignIn';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import {
  clearError,
  loginWithGoogle,
  loginWithPassword,
  registerWithPassword,
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

  // Phone+OTP remains the default; email/password and Google sit alongside it.
  const [method, setMethod] = useState<'phone' | 'email'>('phone');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isRegister, setIsRegister] = useState(false);
  const [googleError, setGoogleError] = useState<string | null>(null);

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  // Only enforced when creating an account — an older password must still work.
  const passwordValid = isRegister
    ? password.length >= 8 && /[A-Za-z]/.test(password) && /\d/.test(password)
    : password.length > 0;

  const handleGoogleOutcome = useCallback(
    (outcome: GoogleSignInOutcome) => {
      // Closing the picker is a normal choice: no error, no state change.
      if (outcome.type === 'cancelled') return;
      if (outcome.type === 'error') {
        setGoogleError(outcome.message);
        return;
      }
      setGoogleError(null);
      void dispatch(loginWithGoogle({ idToken: outcome.idToken }));
    },
    [dispatch],
  );

  const google = useGoogleSignIn(handleGoogleOutcome);

  const handleEmailSubmit = async () => {
    setTouched(true);
    if (!emailValid || !passwordValid) return;
    const credentials = { email: email.trim().toLowerCase(), password };
    if (isRegister) {
      await dispatch(registerWithPassword({ ...credentials, accountType }));
    } else {
      await dispatch(loginWithPassword(credentials));
    }
  };

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
        {method === 'phone'
          ? 'No password. We send a one-time code by SMS and keep you signed in.'
          : isRegister
            ? 'Create an account with your email address.'
            : 'Sign in with your email and password.'}
      </Text>

      {error ?? googleError ? <ErrorBanner message={(error ?? googleError) as string} /> : null}

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

      {method === 'phone' ? (
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
      ) : (
        <>
          <Input
            label="Email"
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            textContentType="emailAddress"
            error={touched && !emailValid ? 'Enter a valid email address' : null}
          />
          <Input
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            textContentType={isRegister ? 'newPassword' : 'password'}
            error={
              touched && !passwordValid
                ? 'Use 8+ characters with a letter and a number'
                : null
            }
            hint={isRegister ? 'At least 8 characters, with a letter and a number.' : undefined}
          />

          {!isRegister ? (
            <PressableScale
              onPress={() => navigation.navigate('ForgotPassword')}
              hitSlop={8}
              accessibilityRole="button"
              style={styles.forgot}
            >
              <Text style={styles.forgotLabel}>Forgot password?</Text>
            </PressableScale>
          ) : null}
        </>
      )}

      {accountType === 'wholesale' && (method === 'phone' || isRegister) ? (
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

      {method === 'phone' ? (
        <Button label="Send verification code" onPress={handleContinue} loading={loading} />
      ) : (
        <Button
          label={isRegister ? 'Create account' : 'Sign in'}
          onPress={handleEmailSubmit}
          loading={loading}
        />
      )}

      <View style={styles.dividerRow}>
        <View style={styles.dividerLine} />
        <Text style={styles.dividerLabel}>or</Text>
        <View style={styles.dividerLine} />
      </View>

      {/* Google's own mark and neutral surface, per their branding guidelines —
          intentionally not the app's coral primary. */}
      <GoogleButton onPress={google.signIn} loading={google.pending} disabled={!google.ready} />

      <PressableScale
        onPress={() => {
          setMethod((current) => (current === 'phone' ? 'email' : 'phone'));
          setTouched(false);
          setGoogleError(null);
          dispatch(clearError());
        }}
        hitSlop={8}
        accessibilityRole="button"
        style={styles.switchMethod}
      >
        <Text style={styles.switchMethodLabel}>
          {method === 'phone' ? 'Use email and password instead' : 'Use my mobile number instead'}
        </Text>
      </PressableScale>

      {method === 'email' ? (
        <PressableScale
          onPress={() => {
            setIsRegister((current) => !current);
            setTouched(false);
            dispatch(clearError());
          }}
          hitSlop={8}
          accessibilityRole="button"
          style={styles.switchMethod}
        >
          <Text style={styles.switchMethodLabel}>
            {isRegister ? 'I already have an account' : 'Create an account'}
          </Text>
        </PressableScale>
      ) : null}

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
  forgot: { alignSelf: 'flex-end', paddingVertical: spacing.sm },
  forgotLabel: { ...typography.footnoteStrong, color: colors.primary },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginVertical: spacing.lg,
  },
  dividerLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.borderStrong },
  dividerLabel: { ...typography.footnote, color: colors.textFaint },
  switchMethod: { alignSelf: 'center', paddingVertical: spacing.md },
  switchMethodLabel: { ...typography.footnoteStrong, color: colors.primary },
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
