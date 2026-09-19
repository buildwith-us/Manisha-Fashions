import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Button, ErrorBanner, Input, Screen } from '../../components/ui';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { requestPasswordReset } from '../../store/slices/authSlice';
import { colors, spacing, typography } from '../../theme';

/**
 * Step 1 of password reset.
 *
 * The confirmation is deliberately non-committal and shown for *every*
 * address: the server will not say whether an account exists, and neither
 * will this screen, or the pair together would leak it anyway.
 */
export function ForgotPasswordScreen() {
  const navigation = useNavigation();
  const dispatch = useAppDispatch();
  const { loading, error } = useAppSelector((state) => state.auth);

  const [email, setEmail] = useState('');
  const [touched, setTouched] = useState(false);
  const [sent, setSent] = useState(false);

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  const handleSubmit = async () => {
    setTouched(true);
    if (!emailValid) return;
    const result = await dispatch(requestPasswordReset(email.trim().toLowerCase()));
    // Rejection here is a transport or rate-limit failure, never "no such
    // account" — the banner shows those, the generic notice shows the rest.
    if (requestPasswordReset.fulfilled.match(result)) setSent(true);
  };

  if (sent) {
    return (
      <Screen scroll>
        <View style={styles.header}>
          <Text style={styles.title}>Check your email</Text>
          <Text style={styles.subtitle}>
            If that email is registered, we've sent a reset link to it. The link expires in 15
            minutes.
          </Text>
        </View>
        <Button label="Back to sign in" onPress={() => navigation.goBack()} />
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <View style={styles.header}>
        <Text style={styles.title}>Reset your password</Text>
        <Text style={styles.subtitle}>
          Enter the email on your account and we'll send you a link to choose a new password.
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
        label="Send reset link"
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
