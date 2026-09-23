import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';
import type * as GoogleSigninModule from '@react-native-google-signin/google-signin';
import { ApiError } from '../api/client';

/**
 * Native Google Sign-In (Android-first).
 *
 * Uses the platform account picker via @react-native-google-signin — never a
 * browser redirect. Google rejects custom-scheme redirect URIs on Android,
 * which is what produced "Error 400: invalid_request" with the old flow.
 *
 * The only thing sent to our API is the ID token; the server verifies it
 * against GOOGLE_WEB_CLIENT_ID, which must be the same web client id set in
 * app.json → extra.googleWebClientId.
 */

type GoogleSignin = typeof GoogleSigninModule;

const PLACEHOLDER_PREFIX = 'REPLACE_WITH';

const webClientId = (Constants.expoConfig?.extra as { googleWebClientId?: unknown } | undefined)
  ?.googleWebClientId;

/**
 * The library touches its native module the moment it is imported, which
 * throws in Expo Go (no native code) and would take the whole app down with
 * it. Loaded lazily so only the Google button is affected there.
 */
let cached: GoogleSignin | null | undefined;
function loadModule(): GoogleSignin | null {
  if (cached !== undefined) return cached;
  if (Platform.OS === 'web' || Constants.executionEnvironment === ExecutionEnvironment.StoreClient) {
    cached = null;
    return cached;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cached = require('@react-native-google-signin/google-signin') as GoogleSignin;
  } catch {
    cached = null;
  }
  return cached;
}

function isConfiguredId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !value.startsWith(PLACEHOLDER_PREFIX);
}

/** Raised for failures the user should see; `message` is already user-facing. */
export class GoogleSignInError extends Error {}

/**
 * Android reports a misconfigured OAuth client (package name / SHA-1 /
 * webClientId mismatch) as Play Services status code 10, which the library
 * passes through as the string "10" rather than a named status code.
 */
const DEVELOPER_ERROR_CODE = '10';

const NOT_SET_UP = "Google Sign-In isn't set up correctly. Please use email login for now.";

/** Call once at app start. Safe to call where the native module is absent. */
export function configureGoogle(): void {
  const module = loadModule();
  if (!module || !isConfiguredId(webClientId)) return;
  module.GoogleSignin.configure({ webClientId, scopes: ['email', 'profile'] });
}

/**
 * Opens the native account picker.
 *
 * Resolves with the ID token, or `null` when the user backed out (or a sign-in
 * was already in flight) — both are silent. Every other failure throws a
 * `GoogleSignInError` carrying a message fit for the UI.
 */
export async function signInWithGoogle(): Promise<string | null> {
  const module = loadModule();
  if (!module) {
    throw new GoogleSignInError('Google Sign-In needs the installed app. Please use email login here.');
  }
  if (!isConfiguredId(webClientId)) {
    if (__DEV__) console.warn('extra.googleWebClientId in app.json is not set.');
    throw new GoogleSignInError(NOT_SET_UP);
  }

  const { GoogleSignin, isErrorWithCode, statusCodes } = module;

  try {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    const response = await GoogleSignin.signIn();
    if (response.type === 'cancelled') return null;

    const idToken = response.data.idToken;
    if (!idToken) {
      // No token almost always means webClientId is not the WEB client's id.
      if (__DEV__) console.warn('Google returned no idToken — check webClientId is the WEB client id.');
      throw new GoogleSignInError(NOT_SET_UP);
    }
    return idToken;
  } catch (error) {
    if (error instanceof GoogleSignInError) throw error;

    if (isErrorWithCode(error)) {
      switch (error.code) {
        case statusCodes.SIGN_IN_CANCELLED:
        case statusCodes.IN_PROGRESS:
          return null;
        case statusCodes.PLAY_SERVICES_NOT_AVAILABLE:
          throw new GoogleSignInError('Google Play Services is required for Google Sign-In.');
        case DEVELOPER_ERROR_CODE:
          if (__DEV__) {
            console.warn(
              'DEVELOPER_ERROR: check package name + SHA-1 in the Android OAuth client and the webClientId',
            );
          }
          throw new GoogleSignInError(NOT_SET_UP);
      }
    }

    if (__DEV__) console.warn('Google Sign-In failed', error);
    throw new GoogleSignInError('Google Sign-In failed. Please try again.');
  }
}

/**
 * Clears the cached Google account so the picker appears next time. Never
 * throws: a failure here must not stop the app's own sign-out.
 */
export async function signOutGoogle(): Promise<void> {
  const module = loadModule();
  if (!module) return;
  try {
    await module.GoogleSignin.signOut();
  } catch {
    // Not signed in with Google, or the native call failed — nothing to undo.
  }
}

/** Maps a failed Google sign-in (device step or API step) to UI copy. */
export function googleErrorMessage(error: unknown): string {
  if (error instanceof GoogleSignInError) return error.message;
  if (error instanceof ApiError) {
    if (error.status === 401) return "Couldn't verify your Google account. Please try again.";
    // 403 deactivated, 409 linked elsewhere, 0 offline, 503 not configured:
    // the server's message already says what to do.
    if ([0, 403, 409, 503].includes(error.status)) return error.message;
  }
  return "Couldn't sign you in with Google. Please try again.";
}
