import { StyleSheet, Text, View } from 'react-native';
import { Icon, type IconName } from '../components/Icon';
import { colors, radius, typography } from '../theme';

/**
 * A tab item's glyph: a 26px outline on the same stroke weight as the rest of
 * the icon set, with the accent count badge riding its top-right corner.
 */
export function TabIcon({
  name,
  focused,
  badge,
}: {
  name: IconName;
  focused: boolean;
  badge?: number;
}) {
  return (
    <View style={styles.wrapper}>
      <Icon
        name={name}
        size={26}
        color={focused ? colors.primary : colors.textPlaceholder}
        strokeWidth={1.6}
      />
      {badge && badge > 0 ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badge > 99 ? '99+' : badge}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { width: 34, alignItems: 'center', justifyContent: 'center' },
  badge: {
    position: 'absolute',
    top: -3,
    right: -3,
    minWidth: 17,
    height: 17,
    paddingHorizontal: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { ...typography.tiny, fontSize: 10, fontWeight: '600', color: colors.textInverse },
});
