import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button, ErrorBanner, Input, Screen } from '../../components/ui';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { requestPasswordReset } from '../../store/slices/authSlice';
import { colors, spacing, typography } from '../../theme';
import type { RootStackParamList } from '../../navigation/types';

/**
 * Step 1 of password reset — ask for the email, send a 6-digit code.
 *
 * Moving straight to the code screen for *every* address is deliberate: the
 * server will not say whether an account exists, so stopping here only for
 * registered ones would leak exactly what the generic response protects.
 */
export function ForgotPasswordScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList, 'ForgotPassword'>>();
  const dispatch = useAppDispatch();
  const { loading, error } = useAppSelector((state) => state.auth);

  const [email, setEmail] = useState('');
  const [touched, setTouched] = useState(false);

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  const handleSubmit = async () => {
    setTouched(true);
    if (!emailValid) return;
    const normalised = email.trim().toLowerCase();
    const result = await dispatch(requestPasswordReset(normalised));
    // Rejection here is a transport or rate-limit failure, never "no such
    // account" — the banner shows those.
    if (requestPasswordReset.fulfilled.match(result)) {
      navigation.navigate('ResetOtp', { email: normalised });
    }
  };

  return (
    <Screen scroll>
      <View style={styles.header}>
        <Text style={styles.title}>Reset your password</Text>
        <Text style={styles.subtitle}>
          Enter the email on your account. If it's registered, we'll send a 6-digit code to it.
        </Text>
      </View>

      {error ? <ErrorBanner message={error} /> : null}

      <Input
        label="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
        placeholder="you@example.com"
        error={touched && !emailValid ? 'Enter a valid email address' : null}
        onBlur={() => setTouched(true)}
      />

      <Button
        label="Send code"
        onPress={handleSubmit}
        loading={loading}
        disabled={!emailValid}
        style={styles.submit}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { marginBottom: spacing.xl, gap: spacing.sm },
  title: { ...typography.title, color: colors.text },
  subtitle: { ...typography.callout, color: colors.textMuted, lineHeight: 21 },
  submit: { marginTop: spacing.lg },
});
