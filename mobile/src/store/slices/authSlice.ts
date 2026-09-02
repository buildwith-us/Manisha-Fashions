import { createAsyncThunk, createSlice, type PayloadAction } from '@reduxjs/toolkit';
import * as Device from 'expo-device';
import { authApi } from '../../api/endpoints';
import { ApiError } from '../../api/client';
import {
  clearTokens,
  getRefreshToken,
  isTokenExpired,
  loadTokens,
  saveTokens,
} from '../../api/tokenStorage';
// ⚠️ TEMPORARY DEV AUTH — REMOVE BEFORE PRODUCTION (see src/config/devAuth.ts)
import { devOtpHintFor, resolveDevSession } from '../../config/devAuth';
import type { Address, User } from '../../api/types';

/**
 * PRD 8.1 authSlice — current user, phone number, account type and wholesale
 * approval status. Also owns the app-start token lifecycle from PRD 8.10.
 */

/**
 * `guest` is a browsing state, not a locked-out one: the catalogue renders for
 * guests and only account-bound actions bounce to sign-in.
 */
export type AuthStatus = 'booting' | 'guest' | 'signedIn';

/**
 * What a guest was trying to do when sign-in interrupted them. Kept
 * serialisable so it can live in the store, and replayed verbatim once the
 * session exists — a guest who tapped "Add to cart" gets that item added, not
 * a trip back to Home.
 */
export type AuthIntent =
  | { type: 'addToCart'; productId: string; quantity: number }
  | { type: 'toggleWishlist'; productId: string }
  | { type: 'openTab'; tab: 'Cart' | 'Wishlist' | 'Orders' | 'Account' }
  | { type: 'checkout' }
  /** A guest who tapped "Buy now" lands on checkout for that product, not the cart. */
  | { type: 'buyNow'; productId: string; quantity: number };

interface AuthState {
  status: AuthStatus;
  user: User | null;
  /** Set when a gated action bounced to sign-in; replayed on success. */
  pendingIntent: AuthIntent | null;
  /** Phone awaiting OTP entry, kept so the OTP screen can resend. */
  pendingPhone: string | null;
  pendingAccountType: 'retail' | 'wholesale';
  /** Wholesale details typed on the login screen, submitted with the OTP. */
  pendingApplication: { businessName?: string; gstNumber?: string } | null;
  /** Populated only in development, where the API echoes the OTP back. */
  devCode: string | null;
  /**
   * ⚠️ TEMPORARY DEV AUTH — REMOVE BEFORE PRODUCTION
   * True only when `sendOtp` could not reach the server and fell back to the
   * offline bypass. Gates the fake-session path in `verifyOtp` so a reachable
   * backend always completes the real handshake.
   */
  devFallback: boolean;
  otpExpiresInSeconds: number;
  loading: boolean;
  error: string | null;
}

const initialState: AuthState = {
  status: 'booting',
  user: null,
  pendingIntent: null,
  pendingPhone: null,
  pendingAccountType: 'retail',
  pendingApplication: null,
  devCode: null,
  devFallback: false,
  otpExpiresInSeconds: 0,
  loading: false,
  error: null,
};

function messageFor(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Something went wrong. Please try again.';
}

/**
 * PRD 8.10 — app start:
 *   no access token         → Home as a guest (no login wall)
 *   token present, expired  → refresh silently; on failure, fall back to guest
 *   token present, valid    → Home, already signed in, no OTP prompt
 *
 * A failed refresh no longer routes anywhere: it drops to guest, and the user
 * is only asked to sign in if they take an action that needs an account.
 */
export const bootstrapSession = createAsyncThunk<User | null>(
  'auth/bootstrap',
  async () => {
    const { accessToken, refreshToken } = await loadTokens();
    if (!accessToken || !refreshToken) return null;

    if (isTokenExpired(accessToken)) {
      try {
        const result = await authApi.refresh(refreshToken);
        await saveTokens(result.accessToken, result.refreshToken);
        return result.user;
      } catch {
        await clearTokens();
        return null;
      }
    }

    try {
      return await authApi.me();
    } catch {
      await clearTokens();
      return null;
    }
  },
);

export const sendOtp = createAsyncThunk<
  { phone: string; devCode?: string; expiresInSeconds: number; devFallback: boolean },
  { phone: string; accountType?: 'retail' | 'wholesale' },
  { rejectValue: string }
>('auth/sendOtp', async ({ phone }, { rejectWithValue }) => {
  try {
    const result = await authApi.sendOtp(phone);
    // The server issued a real code, so this sign-in must be completed against
    // the server. devFallback:false is what stops the bypass hijacking it.
    return {
      phone,
      devCode: result.devCode,
      expiresInSeconds: result.expiresInSeconds,
      devFallback: false,
    };
  } catch (error) {
    // ⚠️ TEMPORARY DEV AUTH — REMOVE BEFORE PRODUCTION
    // The real request is always attempted first. Only when it fails AND the
    // bypass is on do we let the flow continue offline, so the OTP screen is
    // reachable with no SMS provider and no backend. Delete this block with the
    // rest of the bypass.
    const hint = devOtpHintFor(phone);
    if (hint) return { phone, devCode: hint, expiresInSeconds: 300, devFallback: true };

    return rejectWithValue(messageFor(error));
  }
});

export const verifyOtp = createAsyncThunk<
  User,
  {
    phone: string;
    code: string;
    accountType?: 'retail' | 'wholesale';
    application?: { businessName?: string; gstNumber?: string };
  },
  { state: { auth: AuthState }; rejectValue: string }
>('auth/verifyOtp', async (input, { getState, rejectWithValue }) => {
  // ⚠️ TEMPORARY DEV AUTH — REMOVE BEFORE PRODUCTION
  // Additive only: returns null unless DEV_AUTH_BYPASS is on AND the pair
  // matches a dev rule, in which case we never reach the real API. Delete this
  // block and the devAuth import to remove the feature entirely.
  //
  // Gated on devFallback: the bypass mints a fake JWT the real server rejects,
  // so taking it after the server issued a genuine OTP produced a session that
  // "succeeded" and was then torn down by the first 401 — bouncing the user
  // back to sign in and forcing a second, real login. It may only run when the
  // send actually fell back to offline mode.
  if (getState().auth.devFallback) {
    const devSession = resolveDevSession(input.phone, input.code);
    if (devSession) {
      await saveTokens(devSession.accessToken, devSession.refreshToken);
      return devSession.user;
    }
  }

  try {
    const result = await authApi.verifyOtp({
      ...input,
      deviceId: Device.osInternalBuildId ?? Device.modelId ?? undefined,
    });
    await saveTokens(result.accessToken, result.refreshToken);
    return result.user;
  } catch (error) {
    return rejectWithValue(messageFor(error));
  }
});

export const refreshProfile = createAsyncThunk<User>('auth/refreshProfile', async () =>
  authApi.me(),
);

/** PRD 8.10 — logout invalidates the refresh token server-side, not just on-device. */
export const signOut = createAsyncThunk('auth/signOut', async () => {
  const refreshToken = getRefreshToken();
  if (refreshToken) {
    await authApi.logout(refreshToken).catch(() => undefined);
  }
  await clearTokens();
});

export const applyForWholesale = createAsyncThunk<
  User,
  { businessName?: string; gstNumber?: string },
  { rejectValue: string }
>('auth/applyForWholesale', async (input, { rejectWithValue }) => {
  try {
    return await authApi.applyForWholesale(input);
  } catch (error) {
    return rejectWithValue(messageFor(error));
  }
});

export const updateProfile = createAsyncThunk<User, { name?: string; email?: string }>(
  'auth/updateProfile',
  async (input) => authApi.updateProfile(input),
);

/* ── Addresses (PRD 4.3) ────────────────────────────────────────────────── */

export const fetchAddresses = createAsyncThunk<Address[]>('auth/fetchAddresses', async () =>
  authApi.listAddresses(),
);

export const saveAddress = createAsyncThunk<
  Address[],
  { id?: string; input: Omit<Address, 'id' | 'isDefault'> & { isDefault?: boolean } },
  { rejectValue: string }
>('auth/saveAddress', async ({ id, input }, { rejectWithValue }) => {
  try {
    return id ? await authApi.updateAddress(id, input) : await authApi.addAddress(input);
  } catch (error) {
    return rejectWithValue(messageFor(error));
  }
});

export const deleteAddress = createAsyncThunk<Address[], string>(
  'auth/deleteAddress',
  async (id) => authApi.deleteAddress(id),
);

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    /**
     * Called by the Axios interceptor when the refresh token is dead. Drops to
     * guest rather than to a login wall — the catalogue keeps working, and the
     * next gated action is what prompts a sign-in.
     */
    sessionExpired(state) {
      state.status = 'guest';
      state.user = null;
      state.error = 'Your session expired. Please sign in again.';
    },
    /** Records what a guest was attempting before being sent to sign-in. */
    setPendingIntent(state, action: PayloadAction<AuthIntent | null>) {
      state.pendingIntent = action.payload;
    },
    clearPendingIntent(state) {
      state.pendingIntent = null;
    },
    clearError(state) {
      state.error = null;
    },
    resetOtpFlow(state) {
      state.pendingPhone = null;
      state.devCode = null;
      state.devFallback = false;
      state.otpExpiresInSeconds = 0;
      state.error = null;
    },
    setPendingAccountType(state, action: PayloadAction<'retail' | 'wholesale'>) {
      state.pendingAccountType = action.payload;
    },
    setPendingApplication(
      state,
      action: PayloadAction<{ businessName?: string; gstNumber?: string } | null>,
    ) {
      state.pendingApplication = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(bootstrapSession.pending, (state) => {
        state.status = 'booting';
      })
      .addCase(bootstrapSession.fulfilled, (state, action) => {
        state.user = action.payload;
        state.status = action.payload ? 'signedIn' : 'guest';
      })
      .addCase(bootstrapSession.rejected, (state) => {
        state.status = 'guest';
        state.user = null;
      })

      .addCase(sendOtp.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(sendOtp.fulfilled, (state, action) => {
        state.loading = false;
        state.pendingPhone = action.payload.phone;
        state.devCode = action.payload.devCode ?? null;
        state.devFallback = action.payload.devFallback;
        state.otpExpiresInSeconds = action.payload.expiresInSeconds;
      })
      .addCase(sendOtp.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload ?? 'Could not send the code.';
      })

      .addCase(verifyOtp.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(verifyOtp.fulfilled, (state, action) => {
        state.loading = false;
        state.user = action.payload;
        state.status = 'signedIn';
        state.pendingPhone = null;
        state.devCode = null;
        state.pendingApplication = null;
      })
      .addCase(verifyOtp.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload ?? 'Could not verify the code.';
      })

      .addCase(refreshProfile.fulfilled, (state, action) => {
        state.user = action.payload;
      })

      .addCase(signOut.fulfilled, (state) => {
        state.status = 'guest';
        state.pendingIntent = null;
        state.user = null;
        state.pendingPhone = null;
        state.error = null;
      })

      .addCase(applyForWholesale.fulfilled, (state, action) => {
        state.user = action.payload;
      })
      .addCase(applyForWholesale.rejected, (state, action) => {
        state.error = action.payload ?? 'Could not submit your application.';
      })

      .addCase(updateProfile.fulfilled, (state, action) => {
        state.user = action.payload;
      })

      .addCase(fetchAddresses.fulfilled, (state, action) => {
        if (state.user) state.user.addresses = action.payload;
      })
      .addCase(saveAddress.fulfilled, (state, action) => {
        if (state.user) state.user.addresses = action.payload;
      })
      .addCase(saveAddress.rejected, (state, action) => {
        state.error = action.payload ?? 'Could not save the address.';
      })
      .addCase(deleteAddress.fulfilled, (state, action) => {
        if (state.user) state.user.addresses = action.payload;
      });
  },
});

export const {
  sessionExpired,
  setPendingIntent,
  clearPendingIntent,
  clearError,
  resetOtpFlow,
  setPendingAccountType,
  setPendingApplication,
} = authSlice.actions;
export default authSlice.reducer;
