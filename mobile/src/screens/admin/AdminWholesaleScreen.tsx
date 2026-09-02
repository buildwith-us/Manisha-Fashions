import { useCallback, useState } from 'react';
import {
  Pressable,
  Alert,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { PressableScale } from '../../components/motion';
import { useFocusEffect } from '@react-navigation/native';
import {
  Button,
  Chip,
  EmptyState,
  ErrorBanner,
  LargeTitle,
  LoadingView,
  Screen,
  Segmented,
  StatusText,
} from '../../components/ui';
import { adminApi } from '../../api/endpoints';
import { ApiError } from '../../api/client';
import { colors, radius, shadow, spacing, typography } from '../../theme';
import type { User, WholesaleStatus } from '../../api/types';

const TABS: Array<{ value: WholesaleStatus; label: string }> = [
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
];

const COMMON_REASONS = [
  'GST mismatch',
  'No shop proof',
  'Unreachable',
  'Not a trade buyer',
];

const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

/** PRD 4.7 — screens 28 and 32. Approve solid, reject quiet, reason verbatim. */
export function AdminWholesaleScreen() {
  const [status, setStatus] = useState<WholesaleStatus>('pending');
  const [applications, setApplications] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<User | null>(null);

  const load = useCallback(
    async (nextStatus = status) => {
      setLoading(true);
      setError(null);
      try {
        const { data } = await adminApi.listWholesale({ status: nextStatus, page: 1, limit: 50 });
        setApplications(data);
      } catch (caught) {
        setError(caught instanceof ApiError ? caught.message : 'Could not load applications.');
      } finally {
        setLoading(false);
      }
    },
    [status],
  );

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const review = async (user: User, decision: 'approved' | 'rejected', reason?: string) => {
    setBusyId(user.id);
    try {
      await adminApi.reviewWholesale(user.id, decision, reason);
      // The reviewed account leaves the current tab.
      setApplications((current) => current.filter((entry) => entry.id !== user.id));
    } catch (caught) {
      Alert.alert(
        'Could not save',
        caught instanceof ApiError ? caught.message : 'Please try again.',
      );
    } finally {
      setBusyId(null);
    }
  };

  const confirmApprove = (user: User) => {
    Alert.alert(
      'Approve wholesale account?',
      `${user.business?.businessName ?? user.phone} will immediately see wholesale pricing.`,
      [
        { text: 'Not now', style: 'cancel' },
        { text: 'Approve', onPress: () => void review(user, 'approved') },
      ],
    );
  };

  return (
    <Screen>
      <LargeTitle overline="Admin" title="Wholesale">
        <Segmented
          options={TABS}
          value={status}
          onChange={(next) => {
            setStatus(next);
            void load(next);
          }}
          style={{ marginTop: spacing.lg }}
        />
      </LargeTitle>

      {loading && applications.length === 0 ? (
        <LoadingView variant="list" />
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={loading}
              onRefresh={() => void load()}
              tintColor={colors.primary}
            />
          }
        >
          {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}

          {applications.length === 0 ? (
            <EmptyState
              icon="users"
              title={`No ${status} applications`}
              message={
                status === 'pending'
                  ? 'New wholesale signups will appear here for review.'
                  : undefined
              }
            />
          ) : (
            applications.map((user) => (
              <ApplicationCard
                key={user.id}
                user={user}
                status={status}
                busy={busyId === user.id}
                onApprove={() => confirmApprove(user)}
                onReject={() => setRejecting(user)}
              />
            ))
          )}
        </ScrollView>
      )}

      <RejectSheet
        user={rejecting}
        busy={busyId === rejecting?.id}
        onClose={() => setRejecting(null)}
        onSubmit={(reason) => {
          const target = rejecting;
          setRejecting(null);
          if (target) void review(target, 'rejected', reason);
        }}
      />
    </Screen>
  );
}

function ApplicationCard({
  user,
  status,
  busy,
  onApprove,
  onReject,
}: {
  user: User;
  status: WholesaleStatus;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  const gst = user.business?.gstNumber;
  const gstValid = gst ? GSTIN.test(gst) : false;

  const appliedAt = user.business?.appliedAt ? new Date(user.business.appliedAt) : null;
  const waitedDays = appliedAt
    ? Math.floor((Date.now() - appliedAt.getTime()) / 86_400_000)
    : null;
  const waited =
    waitedDays === null
      ? null
      : waitedDays === 0
        ? 'Today'
        : `${waitedDays} day${waitedDays === 1 ? '' : 's'}`;

  return (
    <View style={[styles.card, shadow]}>
      <View style={styles.cardTop}>
        <Text style={styles.business} numberOfLines={1}>
          {user.business?.businessName ?? user.name ?? 'Unnamed business'}
        </Text>
        {waited ? (
          <Text style={[styles.waited, waitedDays !== null && waitedDays >= 2 && styles.waitedLong]}>
            {waited}
          </Text>
        ) : null}
      </View>

      <Text style={styles.phone}>{user.phone}</Text>

      <View style={styles.proofRow}>
        <View style={styles.proof}>
          <Text style={styles.proofText}>No proof</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.gstLabel}>GST number</Text>
          <Text style={[styles.gstValue, !gst && styles.gstMissing]}>
            {gst ?? 'Not provided'}
          </Text>
          <StatusText
            label={
              gst
                ? gstValid
                  ? 'Format valid'
                  : 'Format looks wrong — check before approving'
                : 'Ask before approving'
            }
            color={gst && gstValid ? colors.success : colors.warning}
          />
        </View>
      </View>

      {user.wholesaleRejectionReason ? (
        <View style={styles.reasonBlock}>
          <Text style={styles.reasonLabel}>Reason sent</Text>
          <Text style={styles.reasonText}>{user.wholesaleRejectionReason}</Text>
        </View>
      ) : null}

      {status !== 'approved' ? (
        <View style={styles.actions}>
          <Button
            label="Approve"
            onPress={onApprove}
            loading={busy}
            compact
            style={styles.approve}
          />
          {status === 'pending' ? (
            <PressableScale onPress={onReject} style={styles.reject} accessibilityRole="button">
              <Text style={styles.rejectLabel}>Reject</Text>
            </PressableScale>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/**
 * Screen 32. Replaces the old `Alert.prompt` path, which was iOS-only and sent
 * Android a canned reason — the applicant is shown this text word for word, so
 * both platforms need a real box to type it in.
 */
function RejectSheet({
  user,
  busy,
  onClose,
  onSubmit,
}: {
  user: User | null;
  busy: boolean;
  onClose: () => void;
  onSubmit: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');

  const business = user?.business?.businessName ?? user?.name ?? 'This applicant';

  return (
    <Modal
      visible={user !== null}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      onShow={() => setReason('')}
    >
      {/* Plain Pressable: the scrim is a dismiss target, not a control —
          scaling the dimming layer would read as a glitch. */}
      <Pressable style={styles.scrim} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.grabberRow}>
          <View style={styles.grabber} />
        </View>

        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheetScroll}>
          <Text style={styles.sheetTitle}>Reject this application?</Text>
          <Text style={styles.sheetBody}>
            {business} keeps their retail account and can re-apply. They'll see the reason below
            word for word.
          </Text>

          <Text style={styles.sheetLabel}>Common reasons</Text>
          <View style={styles.reasonChips}>
            {COMMON_REASONS.map((option) => (
              <Chip
                key={option}
                label={option}
                active={reason === option}
                onPress={() => setReason(option)}
              />
            ))}
          </View>

          <Text style={styles.sheetLabel}>Reason sent to the applicant</Text>
          <View style={styles.reasonBox}>
            <TextInput
              value={reason}
              onChangeText={setReason}
              placeholder="Explain what went wrong and what would fix it."
              placeholderTextColor={colors.textDisabled}
              multiline
              style={styles.reasonInput}
            />
          </View>

          <Button
            label="Reject & notify"
            onPress={() => onSubmit(reason.trim())}
            loading={busy}
            disabled={reason.trim().length < 4}
            style={{ marginTop: spacing.xl }}
          />
          <PressableScale onPress={onClose} style={styles.sheetCancel} accessibilityRole="button">
            <Text style={styles.sheetCancelLabel}>Cancel</Text>
          </PressableScale>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({

  list: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xl, gap: spacing.lg },

  card: { padding: spacing.xl, borderRadius: radius.lg, backgroundColor: colors.surface },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  business: { ...typography.heading, color: colors.text, flex: 1 },
  waited: { ...typography.footnoteStrong, color: colors.textFaint },
  waitedLong: { color: colors.primary },
  phone: { ...typography.callout, color: colors.textFaint, marginTop: spacing.xs },

  proofRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md + 2, marginTop: spacing.lg },
  proof: {
    width: 60,
    height: 60,
    borderRadius: 12,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  proofText: { ...typography.tiny, fontWeight: '400', color: colors.textFaint },
  gstLabel: { ...typography.tiny, color: colors.textFaint },
  gstValue: { ...typography.bodyStrong, color: colors.text, marginTop: 3, marginBottom: 3 },
  gstMissing: { color: colors.textFaint },

  reasonBlock: {
    marginTop: spacing.lg,
    padding: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.background,
  },
  reasonLabel: { ...typography.tiny, color: colors.textFaint },
  reasonText: { ...typography.callout, color: colors.text, lineHeight: 22, marginTop: 4 },

  actions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg + 2 },
  approve: { flex: 1, height: 46, borderRadius: 12 },
  reject: {
    flex: 1,
    height: 46,
    borderRadius: 12,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rejectLabel: { ...typography.bodyStrong, color: colors.textMuted },

  scrim: { flex: 1, backgroundColor: colors.scrim },
  sheet: {
    maxHeight: '80%',
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
  },
  grabberRow: { alignItems: 'center', paddingTop: spacing.md + 2, paddingBottom: spacing.sm },
  grabber: { width: 38, height: 5, borderRadius: radius.pill, backgroundColor: colors.borderStrong },
  sheetScroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl },
  sheetTitle: { ...typography.title, fontSize: 24, color: colors.text, marginTop: spacing.md },
  sheetBody: { ...typography.body, color: colors.textMuted, lineHeight: 25, marginTop: spacing.md },
  sheetLabel: {
    ...typography.footnoteStrong,
    color: colors.textFaint,
    marginTop: spacing.xl,
    marginBottom: spacing.sm + 2,
  },
  reasonChips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  reasonBox: {
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.primary,
    paddingHorizontal: spacing.lg + 2,
    paddingVertical: spacing.lg - 2,
  },
  reasonInput: {
    ...typography.body,
    color: colors.text,
    lineHeight: 25,
    minHeight: 76,
    padding: 0,
    textAlignVertical: 'top',
  },
  sheetCancel: { height: 50, alignItems: 'center', justifyContent: 'center', marginTop: spacing.xs },
  sheetCancelLabel: { ...typography.heading, fontWeight: '500', color: colors.textMuted },
});
