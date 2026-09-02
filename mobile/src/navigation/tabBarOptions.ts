import { StyleSheet } from 'react-native';
import { colors } from '../theme';

/**
 * Both shells wear the same bar: a white surface separated from the content by a
 * hairline, a 10px label under a 26px glyph, and the accent only on the active
 * item. The admin side is identified by its content, not by a different skin.
 */
export const tabBarScreenOptions = {
  headerShown: false as const,
  tabBarActiveTintColor: colors.primary,
  tabBarInactiveTintColor: colors.textPlaceholder,
  tabBarLabelStyle: { fontSize: 10, fontWeight: '500' as const, letterSpacing: 0 },
  tabBarStyle: {
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: 8,
  },
  tabBarItemStyle: { paddingVertical: 2 },
};
