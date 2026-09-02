import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Button, Group, Input, KeyboardAwareScrollView, NavBar, Row, Screen, SectionLabel } from '../../components/ui';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { updateProfile } from '../../store/slices/authSlice';
import { colors, spacing, typography, wholesaleStatusStyle } from '../../theme';

/** The account facts that cannot be edited, then the two that can. */
export function ProfileScreen() {
  const navigation = useNavigation();
  const dispatch = useAppDispatch();
  const user = useAppSelector((state) => state.auth.user);

  const [name, setName] = useState(user?.name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);

  const emailInvalid = email.trim().length > 0 && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  const handleSave = async () => {
    setTouched(true);
    if (emailInvalid) return;

    setSaving(true);
    await dispatch(
      updateProfile({
        name: name.trim() || undefined,
        email: email.trim() || undefined,
      }),
    );
    setSaving(false);
    navigation.goBack();
  };

  if (!user) return <Screen />;

  const status = wholesaleStatusStyle[user.wholesaleStatus];
  const accountLabel =
    user.accountType === 'admin'
      ? 'Admin'
      : user.accountType === 'staff'
        ? 'Staff'
        : user.accountType === 'wholesale'
          ? `Wholesale · ${status.label}`
          : 'Retail';

  return (
    <Screen edges={['top']}>
      <NavBar title="Profile" onBack={() => navigation.goBack()} />

      <KeyboardAwareScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.scroll}
      >
        <SectionLabel>Account</SectionLabel>
        <Group>
          <Row label="Mobile number" value={user.phone} />
          <Row label="Account type" value={accountLabel} />
          {user.business?.businessName ? (
            <Row label="Business" value={user.business.businessName} />
          ) : null}
          {user.business?.gstNumber ? <Row label="GSTIN" value={user.business.gstNumber} /> : null}
        </Group>
        <Text style={styles.hint}>
          Your mobile number is your login and cannot be changed here.
        </Text>

        <View style={styles.block}>
          <SectionLabel>Your details</SectionLabel>
          <Group padded>
            <Input
              label="Your name"
              value={name}
              onChangeText={setName}
              placeholder="How should we address you?"
              autoCapitalize="words"
            />
            <Input
              label="Email"
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              keyboardType="email-address"
              autoCapitalize="none"
              error={touched && emailInvalid ? 'Enter a valid email address' : null}
              hint="Optional — used for order receipts only."
            />
            <Button label="Save changes" onPress={handleSave} loading={saving} />
          </Group>
        </View>
      </KeyboardAwareScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: spacing.xl, paddingTop: spacing.md, paddingBottom: spacing.xxxl },
  block: { marginTop: spacing.xl },
  hint: {
    ...typography.footnote,
    color: colors.textFaint,
    lineHeight: 19,
    marginTop: spacing.md,
    paddingHorizontal: spacing.xs,
  },
});
