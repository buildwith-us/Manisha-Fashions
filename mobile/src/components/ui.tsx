import type { ReactNode } from 'react';
import { Children, Fragment, isValidElement, useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewProps,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Icon, type IconName } from './Icon';
import { colors, radius, shadow, shadowAccent, shadowSoft, spacing, typography } from '../theme';
import { motion } from '../theme/motion';
import { ListRowSkeleton, PressableScale, ProductCardSkeleton } from './motion';

/* ── Layout ─────────────────────────────────────────────────────────────── */

/** Breathing room left between the focused field and the top of the keyboard. */
const KEYBOARD_GAP = spacing.lg;

/**
 * A ScrollView that lifts the *focused* field above the keyboard.
 *
 * KeyboardAvoidingView alone only stops the keyboard overlapping the container;
 * a field halfway down a long form still ends up underneath it. This measures
 * the focused input when the keyboard appears and scrolls by exactly the amount
 * needed — nothing moves when the field is already visible, so short screens
 * stay still instead of jumping.
 *
 * Built on React Native's own APIs rather than a keyboard library: the two
 * common choices either need Reanimated and a native build (which would end
 * this project's Expo Go support) or are unmaintained on the New Architecture
 * this app enables.
 */
export function KeyboardAwareScrollView({
  children,
  contentContainerStyle,
  onScroll,
  ...rest
}: ScrollViewProps & { children?: ReactNode }) {
  const scrollRef = useRef<ScrollView>(null);
  const offsetY = useRef(0);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  const trackScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      offsetY.current = event.nativeEvent.contentOffset.y;
      onScroll?.(event);
    },
    [onScroll],
  );

  useEffect(() => {
    // `keyboardDidShow` rather than `willShow`: the frame is final by then, so
    // the measurement is right first time and the scroll is one smooth move.
    const show = Keyboard.addListener('keyboardDidShow', (event) => {
      setKeyboardHeight(event.endCoordinates.height);

      const keyboardTop = event.endCoordinates.screenY;
      const focused = TextInput.State.currentlyFocusedInput();
      if (!focused || typeof focused.measureInWindow !== 'function') return;

      focused.measureInWindow((_x: number, y: number, _w: number, height: number) => {
        const hidden = y + height + KEYBOARD_GAP - keyboardTop;
        // Already clear of the keyboard — leave the scroll position alone so
        // short screens do not jump for no reason.
        if (hidden <= 0) return;

        scrollRef.current?.scrollTo({ y: offsetY.current + hidden, animated: true });
      });
    });

    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardHeight(0));

    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return (
    <ScrollView
      ref={scrollRef}
      onScroll={trackScroll}
      scrollEventThrottle={16}
      // The padding is what makes the scroll above actually reachable: without
      // it a field near the end of the form has nothing to scroll into and the
      // keyboard keeps covering it.
      contentContainerStyle={[contentContainerStyle, { paddingBottom: keyboardHeight }]}
      // Lets a button be tapped while the keyboard is open, instead of the
      // first tap only dismissing it.
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
      showsVerticalScrollIndicator={false}
      {...rest}
    >
      {children}
    </ScrollView>
  );
}

export function Screen({
  children,
  scroll = false,
  edges = ['top'],
  /** `grouped` is the #F5F5F7 ground; `plain` is a white sheet. */
  tone = 'grouped',
  /**
   * Lifts the content clear of the on-screen keyboard. Needed on any screen
   * with a text field far enough down that the keyboard would cover it.
   *
   * This has to wrap the ScrollView rather than sit inside it — a
   * KeyboardAvoidingView nested within a ScrollView does nothing.
   */
  keyboardAvoiding = false,
  style,
  contentStyle,
}: {
  /** Optional so a screen can render an empty shell while data loads. */
  children?: ReactNode;
  scroll?: boolean;
  edges?: Edge[];
  tone?: 'grouped' | 'plain';
  keyboardAvoiding?: boolean;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
}) {
  const ground = tone === 'plain' ? colors.surface : colors.background;

  // A scrolling screen with fields uses the keyboard-aware variant so the
  // focused input is scrolled into view, not merely left un-overlapped.
  const body = scroll ? (
    keyboardAvoiding ? (
      <KeyboardAwareScrollView contentContainerStyle={[styles.scrollContent, contentStyle]}>
        {children}
      </KeyboardAwareScrollView>
    ) : (
      <ScrollView
        contentContainerStyle={[styles.scrollContent, contentStyle]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {children}
      </ScrollView>
    )
  ) : (
    <View style={[{ flex: 1 }, contentStyle]}>{children}</View>
  );

  return (
    <SafeAreaView edges={edges} style={[styles.screen, { backgroundColor: ground }, style]}>
      {keyboardAvoiding ? (
        // 'padding' is the correct iOS behaviour; Android needs 'height' because
        // `undefined` there makes the component a no-op.
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          {body}
        </KeyboardAvoidingView>
      ) : (
        body
      )}
    </SafeAreaView>
  );
}

/**
 * The screen's own title block: a 32px large title over the ground, optionally
 * with a caption and a trailing control. No rule beneath it — the gap is enough.
 */
export function LargeTitle({
  title,
  caption,
  overline,
  right,
  children,
}: {
  title: string;
  caption?: string;
  overline?: string;
  right?: ReactNode;
  /** Search fields and category chips ride inside the header block. */
  children?: ReactNode;
}) {
  return (
    <View style={styles.largeTitle}>
      {overline || right ? (
        <View style={styles.largeTitleTop}>
          <Text style={styles.overline}>{overline ?? ''}</Text>
          {right}
        </View>
      ) : null}
      <Text style={styles.largeTitleText}>{title}</Text>
      {caption ? <Text style={styles.largeTitleCaption}>{caption}</Text> : null}
      {children}
    </View>
  );
}

/** A 52px bar with an accent back chevron — used on pushed screens. */
export function NavBar({
  title,
  onBack,
  right,
  left,
}: {
  title?: string;
  onBack?: () => void;
  right?: ReactNode;
  /** Replaces the back chevron entirely (a "Cancel" text button on a sheet). */
  left?: ReactNode;
}) {
  return (
    <View style={styles.navBar}>
      {left ??
        (onBack ? (
          <Pressable
            onPress={onBack}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Icon name="chevronLeft" size={24} color={colors.primary} />
          </Pressable>
        ) : null)}
      {title ? <Text style={styles.navTitle}>{title}</Text> : null}
      <View style={{ flex: 1 }} />
      {right}
    </View>
  );
}

/**
 * The inset grouped card: a white block on the ground, 16px radius, soft shadow,
 * children separated by hairlines. This is the workhorse of the whole direction.
 */
export function Group({
  children,
  style,
  padded = false,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Adds interior padding for free-form content rather than rows. */
  padded?: boolean;
}) {
  const rows = Children.toArray(children).filter(isValidElement);

  return (
    <View style={[styles.group, padded && styles.groupPadded, shadow, style]}>
      {padded
        ? children
        : rows.map((child, index) => (
            <Fragment key={child.key ?? index}>
              {index > 0 ? <View style={styles.hairline} /> : null}
              {child}
            </Fragment>
          ))}
    </View>
  );
}

/** A row inside a `Group` — label, optional value/detail, optional chevron. */
export function Row({
  label,
  value,
  detail,
  icon,
  onPress,
  chevron = false,
  right,
  tone = 'default',
  style,
}: {
  label: string;
  /** Trailing value text, right-aligned. */
  value?: string;
  /** Secondary line under the label. */
  detail?: string;
  icon?: IconName;
  onPress?: () => void;
  chevron?: boolean;
  right?: ReactNode;
  tone?: 'default' | 'accent' | 'muted';
  style?: StyleProp<ViewStyle>;
}) {
  const labelColor =
    tone === 'accent' ? colors.primary : tone === 'muted' ? colors.textMuted : colors.text;

  const body = (
    <>
      {icon ? (
        <Icon name={icon} size={20} color={colors.textMuted} strokeWidth={1.6} />
      ) : null}
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowLabel, { color: labelColor }]}>{label}</Text>
        {detail ? <Text style={styles.rowDetail}>{detail}</Text> : null}
      </View>
      {value ? <Text style={styles.rowValue}>{value}</Text> : null}
      {right}
      {chevron ? (
        <Icon name="chevronRight" size={17} color={colors.textDisabled} strokeWidth={2} />
      ) : null}
    </>
  );

  if (!onPress) return <View style={[styles.row, style]}>{body}</View>;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed, style]}
    >
      {body}
    </Pressable>
  );
}

/* ── Dense data (admin) ─────────────────────────────────────────────────── */

/**
 * The admin listing row: thumbnail, primary label, secondary metadata, and a
 * trailing value or status. Same inset-grouped card as the customer screens,
 * but packed tighter — admin is a utility surface, not a showcase.
 */
export function ListRow({
  image,
  withThumb = image !== undefined,
  title,
  subtitle,
  detail,
  trailingValue,
  trailingLabel,
  trailingTone = 'default',
  trailing,
  footer,
  onPress,
  dimmed = false,
}: {
  /** A remote URI. */
  image?: string;
  /**
   * Reserve the thumbnail column even when this record has no image, so a
   * listing whose rows are sometimes pictureless still lines up. Defaults to
   * "show it if there is an image".
   */
  withThumb?: boolean;
  title: string;
  subtitle?: string;
  /** A third line — often a ReactNode so prices can carry two colours. */
  detail?: ReactNode;
  /** The right-hand number (stock count, order total). */
  trailingValue?: string;
  /** The caption under it ("in stock", "low"). */
  trailingLabel?: string;
  trailingTone?: 'default' | 'accent' | 'muted';
  /** Replaces the value/label stack entirely (a status pill, a chevron). */
  trailing?: ReactNode;
  /** A full-width action or note under the row's main line. */
  footer?: ReactNode;
  onPress?: () => void;
  /** Hidden, sold out, or deactivated records fade rather than get flagged. */
  dimmed?: boolean;
}) {
  const trailingColor =
    trailingTone === 'accent'
      ? colors.primary
      : trailingTone === 'muted'
        ? colors.textFaint
        : colors.text;

  const body = (
    <>
      <View style={styles.listRowMain}>
        {withThumb ? (
          <Image
            source={image}
            style={styles.listThumb}
            contentFit="cover"
            cachePolicy="memory-disk"
            transition={motion.imageFade}
          />
        ) : null}

        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.listTitle} numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={styles.listSubtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
          {typeof detail === 'string' ? (
            <Text style={styles.listDetail} numberOfLines={1}>
              {detail}
            </Text>
          ) : (
            detail
          )}
        </View>

        {trailing ??
          (trailingValue !== undefined ? (
            <View style={styles.listTrailing}>
              <Text style={[styles.listValue, { color: trailingColor }]}>{trailingValue}</Text>
              {trailingLabel ? (
                <Text
                  style={[
                    styles.listValueLabel,
                    trailingTone === 'accent' && { color: colors.primary },
                  ]}
                >
                  {trailingLabel}
                </Text>
              ) : null}
            </View>
          ) : null)}
      </View>
      {footer}
    </>
  );

  if (!onPress) return <View style={[styles.listRow, dimmed && styles.dimmed]}>{body}</View>;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.listRow, dimmed && styles.dimmed, pressed && styles.rowPressed]}
    >
      {body}
    </Pressable>
  );
}

/**
 * A compact status pill. Order and approval status are coloured *text* in this
 * direction (see `StatusText`) — reach for the pill only where a row already
 * has too much text for another coloured word to read as a status.
 */
export function StatusPill({
  label,
  tone = 'neutral',
}: {
  label: string;
  tone?: 'accent' | 'warning' | 'success' | 'neutral';
}) {
  const palette = {
    accent: { bg: colors.primarySoft, fg: colors.primary },
    warning: { bg: colors.warningSoft, fg: colors.warning },
    success: { bg: colors.successSoft, fg: colors.success },
    neutral: { bg: colors.background, fg: colors.textMuted },
  }[tone];

  return (
    <View style={[styles.statusPill, { backgroundColor: palette.bg }]}>
      <Text style={[styles.statusPillText, { color: palette.fg }]}>{label}</Text>
    </View>
  );
}

/**
 * A dashboard summary card: label, the number, and one line of context.
 * `emphasis` swaps the ambient shadow for the accent glow — reserved for the
 * counts that are actually actionable, so the glow still means something.
 */
export function StatCard({
  label,
  value,
  footnote,
  footnoteTone = 'muted',
  tone = 'default',
  emphasis = false,
  onPress,
}: {
  label: string;
  value: string;
  footnote?: string;
  footnoteTone?: 'muted' | 'success' | 'accent';
  tone?: 'default' | 'accent';
  emphasis?: boolean;
  onPress?: () => void;
}) {
  const Container = onPress ? Pressable : View;

  return (
    <Container
      onPress={onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      style={[styles.statCard, emphasis ? shadowAccent : shadow]}
    >
      <Text style={styles.statLabel}>{label}</Text>
      <Text
        style={[styles.statValue, tone === 'accent' && { color: colors.primary }]}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {value}
      </Text>
      {footnote ? (
        <Text
          style={[
            styles.statFootnote,
            footnoteTone === 'success' && { color: colors.success, fontWeight: '500' },
            footnoteTone === 'accent' && { color: colors.primary, fontWeight: '500' },
          ]}
          numberOfLines={1}
        >
          {footnote}
        </Text>
      ) : null}
    </Container>
  );
}

/**
 * The product form's photo strip: 74px thumbnails with the first one flagged as
 * the cover, plus a tile to add more. With nothing uploaded it becomes the tall
 * empty state from screen 33.
 */
export function ImageSlots({
  uris,
  onAdd,
  onRemove,
  max = 5,
  busy = false,
}: {
  uris: string[];
  onAdd: () => void;
  onRemove: (uri: string) => void;
  max?: number;
  busy?: boolean;
}) {
  if (uris.length === 0) {
    return (
      <Pressable
        onPress={onAdd}
        disabled={busy}
        accessibilityRole="button"
        style={styles.slotEmpty}
      >
        {busy ? (
          <ActivityIndicator color={colors.primary} />
        ) : (
          <>
            <Icon name="upload" size={26} color={colors.primary} />
            <Text style={styles.slotEmptyLabel}>Add up to {max} photos</Text>
            <Text style={styles.slotEmptyHint}>Square crops look best in the grid</Text>
          </>
        )}
      </Pressable>
    );
  }

  return (
    <View style={styles.slotRow}>
      {uris.map((uri, index) => (
        <View key={uri} style={styles.slot}>
          <Image
            source={uri}
            style={styles.slotImage}
            contentFit="cover"
            cachePolicy="memory-disk"
            transition={motion.imageFade}
          />
          {index === 0 ? (
            <View style={styles.slotCover}>
              <Text style={styles.slotCoverText}>Cover</Text>
            </View>
          ) : null}
          <Pressable
            onPress={() => onRemove(uri)}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel="Remove photo"
            style={styles.slotRemove}
          >
            <Icon name="close" size={11} color={colors.textInverse} strokeWidth={2.6} />
          </Pressable>
        </View>
      ))}

      {uris.length < max ? (
        <Pressable
          onPress={onAdd}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="Add a photo"
          style={[styles.slot, styles.slotAdd]}
        >
          {busy ? (
            <ActivityIndicator color={colors.primary} size="small" />
          ) : (
            <Icon name="plus" size={20} color={colors.primary} />
          )}
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * A grouped row that reads as a filled field: a 12px label over a 17px value.
 * This is how the design shows form data — grouped, no boxes.
 */
export function FieldRow({
  label,
  children,
  focused = false,
  style,
}: {
  label: string;
  children: ReactNode;
  /** Draws the 2px accent focus ring the design uses on the active field. */
  focused?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.fieldRow, focused && styles.fieldRowFocused, style]}>
      <Text style={styles.fieldRowLabel}>{label}</Text>
      {children}
    </View>
  );
}

/** The 13px label that sits above a grouped card. */
export function SectionLabel({ children }: { children: ReactNode }) {
  return <Text style={styles.sectionLabel}>{children}</Text>;
}

/**
 * Two or three fields sharing one row of a grouped card, divided by hairlines.
 * The admin product form leans on this: Category | Stock, Retail | Wholesale.
 */
export function SplitRow({ children }: { children: ReactNode }) {
  const cells = Children.toArray(children).filter(isValidElement);

  return (
    <View style={styles.splitRow}>
      {cells.map((cell, index) => (
        <Fragment key={cell.key ?? index}>
          {index > 0 ? <View style={styles.splitDivider} /> : null}
          {cell}
        </Fragment>
      ))}
    </View>
  );
}

/**
 * A `FieldRow` that opens a picker rather than a keyboard — the chevron is the
 * whole affordance, as on the product form's category cell.
 */
export function SelectRow({
  label,
  value,
  placeholder,
  onPress,
  style,
}: {
  label: string;
  value?: string;
  placeholder: string;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.selectRow, pressed && styles.rowPressed, style]}
    >
      <View style={{ flex: 1 }}>
        <Text style={styles.fieldRowLabel}>{label}</Text>
        <Text style={[styles.fieldRowValue, !value && styles.fieldRowPlaceholder]}>
          {value ?? placeholder}
        </Text>
      </View>
      <Icon name="chevronDown" size={15} color={colors.textDisabled} strokeWidth={2} />
    </Pressable>
  );
}

export function SectionHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {action}
    </View>
  );
}

/** A translucent action bar pinned to the bottom of a screen. */
export function FooterBar({
  children,
  tone = 'grouped',
}: {
  children: ReactNode;
  tone?: 'grouped' | 'plain';
}) {
  return (
    <View
      style={[
        styles.footerBar,
        { backgroundColor: tone === 'plain' ? colors.surface : colors.background },
      ]}
    >
      {children}
    </View>
  );
}

/** Retained for the admin screens: a bordered block rather than a grouped list. */
export function Card({
  children,
  style,
  onPress,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
}) {
  if (onPress) {
    return (
      <PressableScale onPress={onPress} style={[styles.card, shadow, style]}>
        {children}
      </PressableScale>
    );
  }
  return <View style={[styles.card, shadow, style]}>{children}</View>;
}

export function Divider() {
  return <View style={styles.hairline} />;
}

/* ── Typography ─────────────────────────────────────────────────────────── */

export function Title({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[styles.title, style]}>{children}</Text>;
}

export function Muted({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[styles.muted, style]}>{children}</Text>;
}

/** Order/application status as coloured text — the design's default treatment. */
export function StatusText({ label, color }: { label: string; color: string }) {
  return <Text style={[styles.statusText, { color }]}>{label}</Text>;
}

/* ── Button ─────────────────────────────────────────────────────────────── */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({
  label,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  fullWidth = true,
  compact = false,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const isDisabled = disabled || loading;
  const isFilled = variant === 'primary' || variant === 'danger';

  // A disabled primary goes grey rather than translucent — the design shows a
  // blocked "Checkout" as #EBEBED on #A1A1A6, not a faded accent button.
  const background = isFilled
    ? isDisabled
      ? colors.fill
      : colors.primary
    : variant === 'secondary'
      ? colors.surface
      : 'transparent';

  const foreground = isFilled
    ? isDisabled
      ? colors.textOnDisabled
      : colors.textInverse
    : colors.primary;

  return (
    // Scale rather than the opacity dim it replaces: a 25% fade reads as
    // "disabled", a 3% scale reads as "listening".
    <PressableScale
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      onPress={onPress}
      disabled={isDisabled}
      style={[
        styles.button,
        compact && styles.buttonCompact,
        { backgroundColor: background, alignSelf: fullWidth ? 'stretch' : 'flex-start' },
        variant === 'secondary' && shadowSoft,
        isFilled && !isDisabled && shadowAccent,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={foreground} size="small" />
      ) : (
        <Text style={[styles.buttonLabel, { color: foreground }]}>{label}</Text>
      )}
    </PressableScale>
  );
}

/* ── Input ──────────────────────────────────────────────────────────────── */

export function Field({
  label,
  error,
  hint,
  children,
}: {
  label?: string;
  error?: string | null;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <View style={styles.field}>
      {label ? <Text style={styles.fieldLabel}>{label}</Text> : null}
      {children}
      {error ? <Text style={styles.fieldError}>{error}</Text> : null}
      {!error && hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
    </View>
  );
}

/** A filled field on a tinted ground — the sign-in screen's number box. */
export function Input({
  label,
  error,
  hint,
  prefix,
  style,
  ...props
}: TextInputProps & {
  label?: string;
  error?: string | null;
  hint?: string;
  /** A static leading affix such as "+91", divided from the value by a rule. */
  prefix?: string;
}) {
  const input = (
    <TextInput
      placeholderTextColor={colors.textDisabled}
      style={[styles.input, prefix ? styles.inputWithPrefix : null, style]}
      {...props}
    />
  );

  return (
    <Field label={label} error={error} hint={hint}>
      <View style={[styles.inputShell, error ? styles.inputShellError : null]}>
        {prefix ? (
          <>
            <Text style={styles.inputPrefix}>{prefix}</Text>
            <View style={styles.inputPrefixRule} />
          </>
        ) : null}
        {input}
      </View>
    </Field>
  );
}

/* ── Selection controls ─────────────────────────────────────────────────── */

/** The iOS segmented control: a tinted track with a white sliding thumb. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  tone = 'grouped',
  style,
}: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (next: T) => void;
  /** `plain` sits on white and needs the darker track. */
  tone?: 'grouped' | 'plain';
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={[
        styles.segmented,
        { backgroundColor: tone === 'plain' ? colors.background : colors.fill },
        style,
      ]}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            style={[styles.segment, active && [styles.segmentActive, shadowSoft]]}
          >
            <Text style={[styles.segmentLabel, active && styles.segmentLabelActive]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A pill filter chip: selected is ink-on-white, unselected is white-on-ground. */
export function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={[styles.chip, active ? styles.chipActive : shadowSoft]}
    >
      <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>{label}</Text>
    </Pressable>
  );
}

/** A filled accent circle with a tick, or an empty ring — the design's radio. */
export function SelectionMark({ selected, size = 22 }: { selected: boolean; size?: number }) {
  if (!selected) {
    return <View style={[styles.markEmpty, { width: size, height: size }]} />;
  }
  return (
    <View style={[styles.markFilled, { width: size, height: size }]}>
      <Icon name="check" size={size * 0.55} color={colors.textInverse} strokeWidth={3.2} />
    </View>
  );
}

export function Toggle({
  value,
  onValueChange,
  disabled = false,
}: {
  value: boolean;
  onValueChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <Switch
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      trackColor={{ true: colors.primary, false: colors.borderStrong }}
      thumbColor={colors.surface}
    />
  );
}

/* ── Badge ──────────────────────────────────────────────────────────────── */

export function Badge({
  label,
  background = colors.background,
  foreground = colors.textMuted,
  style,
}: {
  label: string;
  background?: string;
  foreground?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.badge, { backgroundColor: background }, style]}>
      <Text style={[styles.badgeText, { color: foreground }]}>{label}</Text>
    </View>
  );
}

/** The accent count badge used on tab items and menu rows. */
export function CountBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <View style={styles.countBadge}>
      <Text style={styles.countBadgeText}>{count > 99 ? '99+' : count}</Text>
    </View>
  );
}

/* ── States ─────────────────────────────────────────────────────────────── */

/**
 * Loading state.
 *
 * `list` and `grid` render skeletons in the shape of what is arriving. A
 * spinner only says "something is happening"; a skeleton says what, and roughly
 * how much — which is why it reads as faster at an identical load time. The
 * plain spinner remains the honest choice where the shape genuinely is not
 * known ahead of time.
 */
export function LoadingView({
  label = 'Loading…',
  variant = 'spinner',
}: {
  label?: string;
  variant?: 'spinner' | 'list' | 'grid';
}) {
  if (variant === 'list') {
    return (
      <View style={styles.skeletonList}>
        {Array.from({ length: 6 }).map((_, index) => (
          <ListRowSkeleton key={index} />
        ))}
      </View>
    );
  }

  if (variant === 'grid') {
    return (
      <View style={styles.skeletonGrid}>
        {Array.from({ length: 6 }).map((_, index) => (
          <View key={index} style={styles.skeletonGridCell}>
            <ProductCardSkeleton />
          </View>
        ))}
      </View>
    );
  }

  return (
    <View style={styles.centered}>
      <ActivityIndicator color={colors.primary} size="large" />
      <Text style={styles.mutedCentered}>{label}</Text>
    </View>
  );
}

export function EmptyState({
  icon = 'tag',
  title,
  message,
  action,
}: {
  icon?: IconName;
  title: string;
  message?: string;
  action?: ReactNode;
}) {
  return (
    <View style={styles.centered}>
      <View style={styles.emptyIcon}>
        <Icon name={icon} size={26} color={colors.textFaint} strokeWidth={1.6} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      {message ? <Text style={styles.mutedCentered}>{message}</Text> : null}
      {action ? <View style={{ marginTop: spacing.xl }}>{action}</View> : null}
    </View>
  );
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View style={styles.errorBanner}>
      <Text style={styles.errorText}>{message}</Text>
      {onRetry ? (
        <PressableScale onPress={onRetry} hitSlop={8}>
          <Text style={styles.errorRetry}>Retry</Text>
        </PressableScale>
      ) : null}
    </View>
  );
}

export function InfoBanner({
  message,
  tone = 'info',
}: {
  message: string;
  tone?: 'info' | 'warning' | 'success';
}) {
  const foreground = {
    info: colors.textMuted,
    warning: colors.warning,
    success: colors.success,
  }[tone];

  return (
    <View style={styles.infoBanner}>
      <Text style={[styles.infoText, { color: foreground }]}>{message}</Text>
    </View>
  );
}

/* ── Styles ─────────────────────────────────────────────────────────────── */

const styles = StyleSheet.create({
  screen: { flex: 1 },
  scrollContent: { padding: spacing.lg, paddingBottom: spacing.xxxl },

  largeTitle: { paddingHorizontal: spacing.xl, paddingTop: spacing.lg, paddingBottom: spacing.lg },
  largeTitleTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 24,
  },
  overline: { ...typography.footnoteStrong, color: colors.textFaint },
  largeTitleText: { ...typography.display, color: colors.text, marginTop: spacing.xs },
  largeTitleCaption: { ...typography.caption, color: colors.textFaint, marginTop: spacing.xs },

  navBar: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
  },
  navTitle: { ...typography.heading, color: colors.text },

  group: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  groupPadded: { padding: spacing.xl },
  hairline: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
  },
  rowPressed: { backgroundColor: colors.surfacePressed },
  skeletonList: { paddingTop: spacing.sm },
  skeletonGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: spacing.md },
  skeletonGridCell: { width: '50%' },
  rowLabel: { ...typography.body, color: colors.text },
  rowDetail: { ...typography.caption, color: colors.textFaint, marginTop: 3 },
  rowValue: { ...typography.calloutStrong, color: colors.text },

  /* Dense data (admin) — tighter than the customer rows, same radii and type. */
  listRow: { paddingHorizontal: spacing.lg + 2, paddingVertical: spacing.lg },
  listRowMain: { flexDirection: 'row', alignItems: 'center', gap: spacing.md + 2 },
  dimmed: { opacity: 0.5 },
  listThumb: { width: 56, height: 56, borderRadius: 12, backgroundColor: colors.background },
  listTitle: { ...typography.bodyStrong, color: colors.text },
  listSubtitle: { ...typography.footnote, color: colors.textFaint, marginTop: 3 },
  listDetail: { ...typography.caption, color: colors.textMuted, marginTop: 5 },
  listTrailing: { alignItems: 'flex-end' },
  listValue: { ...typography.heading, color: colors.text },
  listValueLabel: { ...typography.tiny, fontWeight: '400', color: colors.textFaint, marginTop: 2 },

  statusPill: {
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 3,
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
  },
  statusPillText: { ...typography.tiny },

  statCard: {
    flex: 1,
    minWidth: 150,
    padding: spacing.xl - 4,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  statLabel: { ...typography.footnoteStrong, color: colors.textFaint },
  statValue: { ...typography.display, color: colors.text, marginTop: spacing.sm },
  statFootnote: { ...typography.footnote, color: colors.textFaint, marginTop: spacing.xs },

  slotEmpty: {
    height: 132,
    borderRadius: radius.lg,
    backgroundColor: colors.fill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm + 2,
  },
  slotEmptyLabel: { ...typography.bodyStrong, color: colors.primary },
  slotEmptyHint: { ...typography.footnote, color: colors.textFaint },
  slotRow: { flexDirection: 'row', gap: spacing.sm + 2 },
  slot: { width: 74, height: 74, borderRadius: 12, overflow: 'visible' },
  slotImage: { width: 74, height: 74, borderRadius: 12, backgroundColor: colors.background },
  slotAdd: {
    backgroundColor: colors.fill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  slotCover: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingVertical: 3,
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
    backgroundColor: colors.scrimStrong,
    alignItems: 'center',
  },
  slotCoverText: { ...typography.tiny, fontSize: 10, color: colors.textInverse },
  slotRemove: {
    position: 'absolute',
    top: -5,
    right: -5,
    width: 20,
    height: 20,
    borderRadius: radius.pill,
    backgroundColor: colors.text,
    alignItems: 'center',
    justifyContent: 'center',
  },

  splitRow: { flexDirection: 'row' },
  splitDivider: { width: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  selectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg + 2,
    paddingVertical: spacing.lg - 2,
  },
  fieldRowValue: { ...typography.row, color: colors.text, marginTop: 4 },
  fieldRowPlaceholder: { color: colors.textDisabled },

  fieldRow: { paddingHorizontal: spacing.lg + 2, paddingVertical: spacing.lg - 2 },
  fieldRowFocused: {
    borderWidth: 2,
    borderColor: colors.primary,
    borderRadius: 2,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md + 2,
  },
  fieldRowLabel: { ...typography.tiny, color: colors.textFaint },

  sectionLabel: {
    ...typography.footnoteStrong,
    color: colors.textFaint,
    marginBottom: spacing.sm + 2,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  sectionTitle: { ...typography.heading, color: colors.text },

  footerBar: { paddingHorizontal: spacing.xl, paddingTop: spacing.lg, paddingBottom: spacing.xxl },

  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.xl },
  pressed: { opacity: 0.75 },

  title: { ...typography.title, color: colors.text },
  muted: { ...typography.footnote, color: colors.textFaint },
  statusText: { ...typography.captionStrong },

  button: {
    height: 54,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  buttonCompact: { height: 40, borderRadius: radius.sm, paddingHorizontal: spacing.lg },
  buttonLabel: { ...typography.heading },

  field: { marginBottom: spacing.xl },
  fieldLabel: { ...typography.footnoteStrong, color: colors.textMuted, marginBottom: spacing.sm },
  fieldError: { ...typography.footnote, color: colors.primary, marginTop: spacing.sm + 2 },
  fieldHint: { ...typography.footnote, color: colors.textFaint, marginTop: spacing.sm + 2 },
  inputShell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.background,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg + 2,
  },
  inputShellError: { borderWidth: 2, borderColor: colors.primary, paddingHorizontal: spacing.lg },
  input: { flex: 1, paddingVertical: spacing.lg, fontSize: 19, color: colors.text },
  inputWithPrefix: { paddingLeft: 0 },
  inputPrefix: { fontSize: 19, fontWeight: '500', color: colors.textMuted },
  inputPrefixRule: { width: 1, height: 22, backgroundColor: colors.borderFaint },

  // 3px, deliberately off the scale: this is the track inset around a pill
  // inside a pill, where 4 would visibly thicken the surround.
  segmented: { flexDirection: 'row', padding: 3, borderRadius: 11 },
  segment: { flex: 1, paddingVertical: 9, borderRadius: 9, alignItems: 'center' },
  segmentActive: { backgroundColor: colors.surface },
  segmentLabel: { ...typography.captionStrong, color: colors.textMuted },
  segmentLabelActive: { color: colors.text, fontWeight: '600' },

  chip: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  chipActive: { backgroundColor: colors.text },
  chipLabel: { ...typography.captionStrong, color: colors.text },
  chipLabelActive: { color: colors.textInverse },

  markEmpty: {
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
  },
  markFilled: {
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },

  badge: {
    paddingHorizontal: spacing.sm + 1,
    paddingVertical: 3,
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
  },
  badgeText: { ...typography.tiny },
  countBadge: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 7,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countBadgeText: { ...typography.tiny, fontWeight: '600', color: colors.textInverse },

  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xxl,
    backgroundColor: colors.background,
  },
  mutedCentered: {
    ...typography.callout,
    color: colors.textFaint,
    marginTop: spacing.md,
    textAlign: 'center',
    lineHeight: 22,
  },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  emptyTitle: { ...typography.title, color: colors.text, textAlign: 'center' },

  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    backgroundColor: colors.primarySoft,
    padding: spacing.lg,
    borderRadius: radius.md,
    marginBottom: spacing.lg,
  },
  errorText: { ...typography.footnote, color: colors.primary, flex: 1, lineHeight: 19 },
  errorRetry: { ...typography.footnoteStrong, color: colors.primary },

  infoBanner: {
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.background,
    marginBottom: spacing.lg,
  },
  infoText: { ...typography.callout, lineHeight: 23 },
});
