import { useCallback, useEffect, useState } from 'react';
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';

// Closes the in-app browser tab automatically once Google redirects back.
WebBrowser.maybeCompleteAuthSession();

/**
 * Google Sign-In for the Expo **managed** workflow.
 *
 * `expo-auth-session` is the deliberate choice here:
 * @react-native-google-signin/google-signin needs a custom dev client, which
 * would end this project's Expo Go compatibility.
 *
 * Each platform's OAuth client mints tokens carrying its own `aud`, which is
 * why the backend accepts a list (GOOGLE_CLIENT_IDS) rather than one value.
 */
export type GoogleSignInOutcome =
  | { type: 'success'; idToken: string }
  | { type: 'cancelled' }
  | { type: 'error'; message: string };

const clientIds = {
  androidClientId: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID,
  iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
  webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
};

export const googleSignInConfigured = Boolean(
  clientIds.androidClientId ?? clientIds.iosClientId ?? clientIds.webClientId,
);

export function useGoogleSignIn(onOutcome: (outcome: GoogleSignInOutcome) => void) {
  const [request, response, promptAsync] = Google.useIdTokenAuthRequest(clientIds);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!response) return;
    setPending(false);

    if (response.type === 'success') {
      const idToken = response.params?.id_token ?? response.authentication?.idToken;
      if (idToken) {
        onOutcome({ type: 'success', idToken });
      } else {
        // Google answered but withheld the ID token — treat as a failure
        // rather than a silent no-op, which would look like a dead button.
        onOutcome({ type: 'error', message: 'Google did not return a sign-in token.' });
      }
      return;
    }

    // Dismissing the picker is an ordinary choice, not an error to report.
    if (response.type === 'cancel' || response.type === 'dismiss') {
      onOutcome({ type: 'cancelled' });
      return;
    }

    onOutcome({ type: 'error', message: 'Google sign-in could not be completed.' });
  }, [response, onOutcome]);

  const signIn = useCallback(async () => {
    if (!request) return;
    setPending(true);
    try {
      await promptAsync();
    } catch {
      setPending(false);
      // Thrown before the browser opens — usually no network.
      onOutcome({ type: 'error', message: 'Could not reach Google. Check your connection.' });
    }
  }, [request, promptAsync, onOutcome]);

  return {
    signIn,
    /** False until the auth request is built; the button stays disabled. */
    ready: Boolean(request) && googleSignInConfigured,
    pending,
  };
}
