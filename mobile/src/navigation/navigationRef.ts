import { createNavigationContainerRef } from '@react-navigation/native';
import type { RootStackParamList } from './types';

/**
 * Lets non-screen code navigate — specifically the pending-intent runner, which
 * replays a guest's interrupted action after sign-in and therefore has to act
 * from outside any single screen's context.
 */
export const navigationRef = createNavigationContainerRef<RootStackParamList>();
