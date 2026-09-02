import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { CommonActions, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button, ErrorBanner, InfoBanner, NavBar, Screen } from '../../components/ui';
import { PressableScale } from '../../components/motion';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { clearError, resetOtpFlow, sendOtp, verifyOtp } from '../../store/slices/authSlice';
// ⚠️ TEMPORARY DEV AUTH — REMOVE BEFORE PRODUCTION (see src/config/devAuth.ts)
import { devOtpHintFor } from '../../config/devAuth';
import { colors, radius, spacing, typography } from '../../theme';
import type { RootStackParamList } from '../../navigation/types';

const OTP_LENGTH = 6;
const RESEND_SECONDS = 30;

/**
 * PRD 4.1 / 8.7 — OTP entry. On success the session token is stored and the
 * user is not asked again until logout, reinstall, or idle expiry — which is
 * what the note under the boxes promises.
 */
export function OtpScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList, 'Otp'>>();
  const dispatch = useAppDispatch();
  const { pendingPhone, pendingAccountType, pendingApplication, devCode, loading, error } =
    useAppSelector((state) => state.auth);

  const [code, setCode] = useState('');
  const [secondsLeft, setSecondsLeft] = useState(RESEND_SECONDS);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    const timer = setInterval(() => {
      setSecondsLeft((current) => (current > 0 ? current - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    // Dev convenience: the API echoes the code back outside production.
    if (devCode) setCode(devCode);
  }, [devCode]);

  // ⚠️ TEMPORARY DEV AUTH — REMOVE BEFORE PRODUCTION
  // The dev codes are 4 digits while a real OTP is 6, so submission accepts
  // either: a full-length real code, or an exact match on the dev code. Real
  // 6-digit entry is unaffected, and devHint is null whenever the flag is off.
  const devHint = pendingPhone ? devOtpHintFor(pendingPhone) : null;
  const isSubmittable = (value: string) =>
    value.length === OTP_LENGTH || (devHint !== null && value === devHint);

  const submit = async (value: string) => {
    if (!pendingPhone || !isSubmittable(value)) return;
    const result = await dispatch(
      verifyOtp({
        phone: pendingPhone,
        code: value,
        accountType: pendingAccountType,
        application: pendingApplication ?? undefined,
      }),
    );

    // Staff and blocked-wholesale accounts swap the whole stack, which unmounts
    // this modal on its own. A retail or approved-wholesale customer stays in
    // the customer stack, so the Otp + Login modals have to be dismissed to put
    // them back on the screen they came from — with their action replayed by
    // PendingIntentRunner.
    //
    // The modals are filtered out by name rather than popped by count:
    // PendingIntentRunner navigates as soon as `status` flips to signedIn,
    // which happens before this line runs, so a fixed pop(2) raced that
    // navigation and left the user on the Login screen to dismiss by hand.
    if (verifyOtp.fulfilled.match(result)) {
      navigation.dispatch((state) => {
        const routes = state.routes.filter(
          (route) => route.name !== 'Login' && route.name !== 'Otp',
        );
        // Nothing left to drop, or nothing to do — leave the stack untouched.
        if (routes.length === 0 || routes.length === state.routes.length) {
          return CommonActions.reset(state);
        }
        return CommonActions.reset({ ...state, routes, index: routes.length - 1 });
      });
    }
  };

  const handleChange = (value: string) => {
    const digits = value.replace(/\D/g, '').slice(0, OTP_LENGTH);
    setCode(digits);
    if (error) dispatch(clearError());
    if (isSubmittable(digits)) void submit(digits);
  };

  const handleResend = async () => {
    if (!pendingPhone || secondsLeft > 0) return;
    setCode('');
    setSecondsLeft(RESEND_SECONDS);
    await dispatch(sendOtp({ phone: pendingPhone, accountType: pendingAccountType }));
  };

  const handleBack = () => {
    dispatch(resetOtpFlow());
    navigation.goBack();
  };

  // The code field autofocuses, so the keyboard is already up on arrival and
  // would otherwise sit over "Verify & continue". No `scroll` alongside it: the
  // body is flex:1 with the button pinned beneath, and making that scrollable
  // would break the layout rather than help it.
  return (
    <Screen tone="plain" edges={['top', 'bottom']} keyboardAvoiding>
      <NavBar onBack={handleBack} />

      <View style={styles.body}>
        <Text style={styles.heading}>Enter the code</Text>
        <Text style={styles.subheading}>
          Sent to <Text style={styles.subheadingStrong}>{pendingPhone ?? 'your number'}</Text>.{' '}
          <Text style={styles.link} onPress={handleBack}>
            Change
          </Text>
        </Text>

        {error ? <ErrorBanner message={error} /> : null}

        {devCode ? (
          <InfoBanner message={`Development mode — code auto-filled: ${devCode}`} tone="warning" />
        ) : null}

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

        {/* A single hidden input backs the six boxes so SMS autofill works. */}
        <TextInput
          ref={inputRef}
          value={code}
          onChangeText={handleChange}
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete="sms-otp"
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
            You'll only do this once. The app stays signed in until you log out or change device.
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
