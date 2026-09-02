import { useCallback } from 'react';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { setPendingIntent, type AuthIntent } from '../store/slices/authSlice';
import type { RootStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/**
 * Gates an action rather than a screen (PRD 4.1, guest-first entry).
 *
 * The catalogue and product detail render for everybody. Anything that needs an
 * account — cart, wishlist, checkout, orders, the account tab — calls
 * `requireAuth`, which either runs the action immediately or records what was
 * being attempted and opens sign-in over the top. Sign-in is a modal, so
 * backing out returns the guest exactly where they were.
 */
export function useAuthGate() {
  const dispatch = useAppDispatch();
  const navigation = useNavigation<Nav>();
  const isSignedIn = useAppSelector((state) => state.auth.status === 'signedIn');

  const requireAuth = useCallback(
    (intent: AuthIntent, run: () => void) => {
      if (isSignedIn) {
        run();
        return;
      }
      dispatch(setPendingIntent(intent));
      navigation.navigate('Login');
    },
    [dispatch, isSignedIn, navigation],
  );

  return { isSignedIn, requireAuth };
}
