import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button, ErrorBanner, Input, Screen } from '../../components/ui';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { submitPasswordReset } from '../../store/slices/authSlice';
import { colors, spacing, typography } from '../../theme';
import type { RootStackParamList } from '../../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList, 'ResetPassword'>;
type ResetRoute = RouteProp<RootStackParamList, 'ResetPassword'>;

/**
 * Step 3 of password reset — choose the new password.
 *
 * The token is a route param handed over by the code screen, so it never
 * leaves the app; it is short-lived and single-use.
 *
 * Mirrors the backend rule so the user is told before submitting, not after:
 * at least 8 characters, with a letter and a number.
 */
export function ResetPasswordScreen() {
  const navigation = useNavigation<Nav>();
  const { params } = useRoute<ResetRoute>();
  const dispatch = useAppDispatch();
  const { loading, error } = useAppSelector((state) => state.auth);

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [touched, setTouched] = useState(false);

  const token = params?.token ?? '';

  const strongEnough = password.length >= 8 && /[A-Za-z]/.test(password) && /\d/.test(password);
  const matches = password === confirm;
  const canSubmit = Boolean(token) && strongEnough && matches;

  const handleSubmit = async () => {
    setTouched(true);
    if (!canSubmit) return;
    const result = await dispatch(submitPasswordReset({ token, password }));
    if (submitPasswordReset.fulfilled.match(result)) {
      // Every session was revoked server-side, so sign-in is the only way on.
      navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
    }
  };

  // Opening the app on this route without a token means a malformed link.
  if (!token) {
    return (
      <Screen scroll>
        <View style={styles.header}>
          <Text style={styles.title}>This request isn't valid</Text>
          <Text style={styles.subtitle}>
            Reset codes expire after 10 minutes and can only be used once. Please start again.
          </Text>
        </View>
        <Button label="Back to sign in" onPress={() => navigation.navigate('Login')} />
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <View style={styles.header}>
        <Text style={styles.title}>Choose a new password</Text>
        <Text style={styles.subtitle}>
          At least 8 characters, including a letter and a number.
        </Text>
      </View>

      {error ? <ErrorBanner message={error} /> : null}

      <Input
        label="New password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
        textContentType="newPassword"
        error={touched && !strongEnough ? 'Use 8+ characters with a letter and a number' : null}
      />

      <Input
        label="Confirm password"
        value={confirm}
        onChangeText={setConfirm}
        secureTextEntry
        autoCapitalize="none"
        textContentType="newPassword"
        error={touched && !matches ? "These passwords don't match" : null}
        onBlur={() => setTouched(true)}
      />

      <Button
        label="Change password"
        onPress={handleSubmit}
        loading={loading}
        disabled={!canSubmit}
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
