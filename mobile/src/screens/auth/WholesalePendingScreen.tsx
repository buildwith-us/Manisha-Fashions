import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, Group, Input, Screen, SectionLabel } from '../../components/ui';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { applyForWholesale, refreshProfile, signOut } from '../../store/slices/authSlice';
import { colors, radius, shadow, shadowSoft, spacing, typography } from '../../theme';

/**
 * PRD 4.1 — a wholesale account that is pending or rejected can sign in and see
 * its status, and nothing else. Rejected applicants get the reason verbatim and
 * can re-apply or keep shopping at retail prices.
 */
export function WholesalePendingScreen() {
  const dispatch = useAppDispatch();
  const user = useAppSelector((state) => state.auth.user);
  const error = useAppSelector((state) => state.auth.error);

  const [businessName, setBusinessName] = useState(user?.business?.businessName ?? '');
  const [gstNumber, setGstNumber] = useState(user?.business?.gstNumber ?? '');
  const [checking, setChecking] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const rejected = user?.wholesaleStatus === 'rejected';

  useEffect(() => {
    // Approval happens on the admin's side, so re-check on mount.
    void dispatch(refreshProfile());
  }, [dispatch]);

  const handleCheckStatus = async () => {
    setChecking(true);
    await dispatch(refreshProfile());
    setChecking(false);
  };

  const handleReapply = async () => {
    setSubmitting(true);
    await dispatch(
      applyForWholesale({
        businessName: businessName.trim() || undefined,
        gstNumber: gstNumber.trim() || undefined,
      }),
    );
    setSubmitting(false);
  };

  return (
    <Screen edges={['top', 'bottom']}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <View style={[styles.statusPill, shadowSoft]}>
            <View style={[styles.statusDot, rejected && styles.statusDotQuiet]} />
            <Text style={[styles.statusLabel, rejected && styles.statusLabelQuiet]}>
              {rejected ? 'Not approved' : 'Under review'}
            </Text>
          </View>

          <Text style={styles.heading}>
            {rejected ? "We couldn't verify your business" : "We're checking your details"}
          </Text>

          {!rejected ? (
            <Text style={styles.subheading}>
              {user?.business?.businessName ? `${user.business.businessName} · ` : ''}
              Most applications are answered the same working day.
            </Text>
          ) : null}
        </View>

        {rejected ? (
          <View style={[styles.reasonCard, shadow]}>
            <Text style={styles.reasonLabel}>Reason from the shop</Text>
            <Text style={styles.reasonText}>
              {user?.wholesaleRejectionReason ??
                'The details on your application could not be verified. Re-apply with a photo of your shop board or licence.'}
            </Text>
          </View>
        ) : (
          <View style={[styles.timelineCard, shadow]}>
            <TimelineStep
              title="Application received"
              detail="Submitted from this device"
              state="done"
            />
            <TimelineStep title="Admin review" detail="In progress" state="current" />
            <TimelineStep
              title="Wholesale pricing unlocked"
              detail="Sign in again once approved"
              state="pending"
              last
            />
          </View>
        )}

        <Text style={styles.note}>
          {rejected
            ? 'You can keep shopping at retail prices in the meantime — nothing in your cart is lost.'
            : 'Browsing and ordering stay closed while your application is open — this keeps wholesale rates off retail accounts.'}
        </Text>

        {rejected ? (
          <View style={styles.reapply}>
            <SectionLabel>Update your details and re-apply</SectionLabel>
            <Group padded>
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
                error={error}
              />
              <Button label="Re-apply" onPress={handleReapply} loading={submitting} />
            </Group>
          </View>
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        {!rejected ? (
          <Button
            label="Check approval status"
            onPress={handleCheckStatus}
            loading={checking}
            variant="secondary"
          />
        ) : null}
        <Button label="Log out" onPress={() => dispatch(signOut())} variant="ghost" />
      </View>
    </Screen>
  );
}

function TimelineStep({
  title,
  detail,
  state,
  last = false,
}: {
  title: string;
  detail: string;
  state: 'done' | 'current' | 'pending';
  last?: boolean;
}) {
  const reached = state !== 'pending';

  return (
    <View style={styles.step}>
      <View style={styles.stepRail}>
        <View style={[styles.stepDot, reached && styles.stepDotReached]} />
        {!last ? <View style={[styles.stepLine, state === 'done' && styles.stepLineDone]} /> : null}
      </View>
      <View style={[styles.stepBody, last && { paddingBottom: 0 }]}>
        <Text style={[styles.stepTitle, !reached && styles.stepTitleQuiet]}>{title}</Text>
        <Text style={styles.stepDetail}>{detail}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: spacing.xl },
  header: { paddingHorizontal: spacing.xl, paddingTop: spacing.xxxl },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.lg - 2,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  statusDot: { width: 7, height: 7, borderRadius: radius.pill, backgroundColor: colors.primary },
  statusDotQuiet: { backgroundColor: colors.textPlaceholder },
  statusLabel: { ...typography.footnoteStrong, color: colors.text },
  statusLabelQuiet: { color: colors.textMuted },

  heading: { ...typography.display, color: colors.text, lineHeight: 37, marginTop: spacing.xl },
  subheading: { ...typography.body, color: colors.textMuted, lineHeight: 25, marginTop: spacing.md },

  timelineCard: {
    margin: spacing.xl,
    padding: spacing.xl,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
  },
  step: { flexDirection: 'row', gap: spacing.lg },
  stepRail: { alignItems: 'center', paddingTop: 4 },
  stepDot: {
    width: 10,
    height: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.borderStrong,
  },
  stepDotReached: { backgroundColor: colors.primary },
  stepLine: { width: 2, flex: 1, backgroundColor: colors.fill, marginVertical: 6 },
  stepLineDone: { backgroundColor: colors.primary },
  stepBody: { flex: 1, paddingBottom: spacing.xl },
  stepTitle: { ...typography.bodyStrong, fontWeight: '600', color: colors.text },
  stepTitleQuiet: { color: colors.textFaint },
  stepDetail: { ...typography.caption, color: colors.textFaint, marginTop: 3 },

  reasonCard: {
    margin: spacing.xl,
    padding: spacing.xl,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
  },
  reasonLabel: { ...typography.tiny, color: colors.textFaint },
  reasonText: { ...typography.row, color: colors.text, lineHeight: 26, marginTop: spacing.sm + 2 },

  note: {
    paddingHorizontal: spacing.xl,
    ...typography.callout,
    color: colors.textFaint,
    lineHeight: 24,
  },

  reapply: { paddingHorizontal: spacing.xl, paddingTop: spacing.xl },

  footer: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xl, gap: spacing.xs },
});
