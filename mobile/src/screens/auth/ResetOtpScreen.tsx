import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button, ErrorBanner, NavBar, Screen } from '../../components/ui';
import { PressableScale } from '../../components/motion';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { clearError, requestPasswordReset, verifyResetOtp } from '../../store/slices/authSlice';
import { colors, radius, spacing, typography } from '../../theme';
import type { RootStackParamList } from '../../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList, 'ResetOtp'>;

const OTP_LENGTH = 6;
/**
 * The backend allows 3 reset emails per hour, so a 30-second cooldown would
 * invite the user to burn the whole quota in 90 seconds and then be stuck for
 * the rest of the hour. 60s paces three requests across three minutes and
 * still leaves the limit as the real ceiling.
 */
const RESEND_SECONDS = 60;

/**
 * Step 2 of password reset — enter the 6-digit code from the email.
 *
 * Six boxes over one hidden input, the same pattern the phone-OTP screen used,
 * so one-time-code autofill still works. The code arrives by email rather than
 * SMS, hence `oneTimeCode` without the `sms-otp` hint.
 */
export function ResetOtpScreen() {
  const navigation = useNavigation<Nav>();
  const { params } = useRoute<RouteProp<RootStackParamList, 'ResetOtp'>>();
  const dispatch = useAppDispatch();
  const { loading, error } = useAppSelector((state) => state.auth);

  const inputRef = useRef<TextInput>(null);
  const [code, setCode] = useState('');
  const [secondsLeft, setSecondsLeft] = useState(RESEND_SECONDS);

  const email = params.email;
  const isSubmittable = (value: string) => value.length === OTP_LENGTH;

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const timer = setInterval(() => setSecondsLeft((current) => current - 1), 1000);
    return () => clearInterval(timer);
  }, [secondsLeft]);

  const submit = async (value: string) => {
    if (!isSubmittable(value)) return;
    const result = await dispatch(verifyResetOtp({ email, otp: value }));
    if (verifyResetOtp.fulfilled.match(result)) {
      // The token is short-lived and single-use, so it is handed straight to
      // the next screen rather than parked in the store.
      navigation.replace('ResetPassword', { token: result.payload.resetToken });
    } else {
      // A rejected code stays on screen otherwise, inviting a blind re-submit.
      setCode('');
    }
  };

  const handleChange = (value: string) => {
    const digits = value.replace(/\D/g, '').slice(0, OTP_LENGTH);
    setCode(digits);
    if (error) dispatch(clearError());
    if (isSubmittable(digits)) void submit(digits);
  };

  const handleResend = async () => {
    if (secondsLeft > 0) return;
    setCode('');
    setSecondsLeft(RESEND_SECONDS);
    await dispatch(requestPasswordReset(email));
  };

  return (
    <Screen tone="plain" edges={['top', 'bottom']} keyboardAvoiding>
      <NavBar onBack={() => navigation.goBack()} />

      <View style={styles.body}>
        <Text style={styles.heading}>Enter the code</Text>
        <Text style={styles.subheading}>
          Sent to <Text style={styles.subheadingStrong}>{email}</Text>.{' '}
          <Text style={styles.link} onPress={() => navigation.goBack()}>
            Change
          </Text>
        </Text>

        {error ? <ErrorBanner message={error} /> : null}

        <PressableScale onPress={() => inputRef.current?.focus()} style={styles.boxes}>
          {Array.from({ length: OTP_LENGTH }).map((_, index) => {
            const active = index === code.length;
            return (
              <View key={index} style={[styles.box, active && styles.boxActive]}>
                {active && !code[index] ? (
                  <View style={styles.caret} />
                ) : (
                  <Text style={styles.boxText}>{code[index] ?? ''}</Text>
                )}
              </View>
            );
          })}
        </PressableScale>

        <TextInput
          ref={inputRef}
          value={code}
          onChangeText={handleChange}
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          maxLength={OTP_LENGTH}
          autoFocus
          style={styles.hiddenInput}
        />

        <View style={styles.resendRow}>
          <Text style={styles.resendLabel}>Didn't get it?</Text>
          <PressableScale onPress={handleResend} disabled={secondsLeft > 0} hitSlop={8}>
            <Text style={[styles.resendAction, secondsLeft > 0 && styles.resendWaiting]}>
              {secondsLeft > 0
                ? `Resend in 0:${String(secondsLeft).padStart(2, '0')}`
                : 'Resend code'}
            </Text>
          </PressableScale>
        </View>

        <View style={styles.note}>
          <Text style={styles.noteText}>
            The code expires in 10 minutes. After five wrong attempts this email is locked for a
            short while.
          </Text>
        </View>
      </View>

      <View style={styles.footer}>
        <Button
          label="Verify & continue"
          onPress={() => submit(code)}
          loading={loading}
          disabled={!isSubmittable(code)}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, paddingHorizontal: spacing.xxl, paddingTop: spacing.xl },
  heading: { ...typography.hero, color: colors.text, lineHeight: 38 },
  subheading: { ...typography.row, color: colors.textMuted, lineHeight: 26, marginTop: spacing.md },
  subheadingStrong: { color: colors.text, fontWeight: '500' },
  link: { color: colors.primary },

  boxes: { flexDirection: 'row', gap: spacing.sm + 2, marginTop: spacing.xxxl },
  box: {
    flex: 1,
    height: 60,
    borderRadius: radius.md,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxActive: { backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.primary },
  boxText: { fontSize: 26, fontWeight: '500', color: colors.text },
  caret: { width: 2, height: 26, borderRadius: 2, backgroundColor: colors.primary },
  hiddenInput: { position: 'absolute', opacity: 0, height: 1, width: 1 },

  resendRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginTop: spacing.xl,
  },
  resendLabel: { ...typography.callout, color: colors.textMuted },
  resendAction: { ...typography.calloutStrong, color: colors.primary },
  resendWaiting: { color: colors.textDisabled },

  note: {
    marginTop: spacing.xxl,
    padding: spacing.xl,
    borderRadius: radius.lg,
    backgroundColor: colors.background,
  },
  noteText: { ...typography.callout, color: colors.textMuted, lineHeight: 23 },

  footer: { paddingHorizontal: spacing.xxl, paddingBottom: spacing.xxxl },
});
