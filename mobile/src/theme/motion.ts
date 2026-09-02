import { Easing } from 'react-native';

/**
 * Motion tokens — the RN re-expression of the design-engineering rules in
 * .claude/skills/emil-design-eng.
 *
 * That skill is written for CSS (`transition: transform 160ms ease-out`,
 * `:active`, `cubic-bezier`). None of that exists here, so the *decisions* are
 * carried over and the syntax is restated in terms React Native has:
 * `Animated`, `Easing`, and Pressable's `({ pressed })`.
 *
 * Durations sit in the skill's 150–250ms band for UI. Anything longer reads as
 * sluggish; the checklist flags >300ms outright.
 */
export const motion = {
  duration: {
    /** Press feedback and other "instant" acknowledgements. */
    press: 120,
    /** The default for UI transitions — the skill's 160ms button figure. */
    fast: 160,
    /** Entrances with distance to cover. */
    base: 200,
    /** The top of the band. Nothing in the app should exceed this. */
    slow: 250,
    /**
     * Exits are deliberately quicker than entrances. The skill is explicit:
     * "Make exit faster than enter" — leaving should never make someone wait.
     */
    exit: 140,
  },

  /**
   * ease-out for anything entering or responding to a tap: the movement is
   * fastest at the start, so the interface reads as immediately responsive.
   * The skill rejects ease-in on UI for exactly this reason.
   */
  easeOut: Easing.out(Easing.cubic),
  /** Only for things leaving the screen, where acceleration away is correct. */
  easeIn: Easing.in(Easing.cubic),

  /** Subtle range is 0.95–0.98; 0.97 is the skill's stated default. */
  pressScale: 0.97,
  /** Small circular controls need a touch more to register at their size. */
  pressScaleSmall: 0.92,
  /** Paired with the scale — a hint, not the 0.75 dimming it replaces. */
  pressOpacity: 0.92,

  /** 30–80ms between items. 40 keeps a 10-item list under half a second. */
  stagger: 40,
  /** Past this the delay is capped, so item 30 never waits 1.2s to appear. */
  staggerMaxIndex: 8,

  /** expo-image crossfade. Matches the 180ms ProductCard already uses. */
  imageFade: 180,
} as const;
