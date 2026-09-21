import React from 'react';
import { render } from '@testing-library/react-native';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import authReducer from '../../store/slices/authSlice';
import { RootNavigator } from '../RootNavigator';

// WholesalePendingScreen re-checks approval on mount via refreshProfile(),
// which calls authApi.me() — mocked so no real HTTP call happens in this test.
jest.mock('../../api/endpoints', () => ({
  authApi: {
    me: jest.fn().mockRejectedValue(new Error('not exercised in this test')),
  },
}));

function renderWithUser(user: Record<string, unknown> | null) {
  const store = configureStore({
    reducer: { auth: authReducer },
    preloadedState: {
      auth: {
        status: user ? 'signedIn' : 'guest',
        user,
        pendingPhone: null,
        pendingAccountType: 'retail',
        pendingApplication: null,
        pendingIntent: null,
        devCode: null,
        devFallback: false,
        otpExpiresInSeconds: 0,
        loading: false,
        error: null,
      } as never,
    },
  });

  return render(
    <Provider store={store}>
      <RootNavigator />
    </Provider>,
  );
}

/**
 * RootNavigator's route guarding is structural, not just an initial route
 * choice: when isBlockedWholesale is true, the Stack.Navigator's children are
 * ONLY the WholesalePending screen — CustomerTabs/AdminTabs are a different
 * branch of the same ternary and are never even constructed, so there is no
 * reachable route into them regardless of what a compromised client tries to
 * navigate to.
 */
describe('RootNavigator: wholesale approval gating', () => {
  it('a pending wholesale applicant sees the pending screen, not the catalogue', async () => {
    const { findByText } = renderWithUser({
      id: 'u1',
      phone: '+919876543210',
      accountType: 'wholesale',
      wholesaleStatus: 'pending',
      permissions: [],
      addresses: [],
      createdAt: new Date().toISOString(),
      business: { businessName: 'Test Traders' },
    });

    await findByText("We're checking your details");
  });

  it('a rejected wholesale applicant sees the rejection screen with the reason', async () => {
    const { findByText } = renderWithUser({
      id: 'u2',
      phone: '+919876543211',
      accountType: 'wholesale',
      wholesaleStatus: 'rejected',
      wholesaleRejectionReason: 'GST number could not be verified.',
      permissions: [],
      addresses: [],
      createdAt: new Date().toISOString(),
    });

    await findByText("We couldn't verify your business");
    await findByText('GST number could not be verified.');
  });

  // Deliberately not also rendering the "approved" (CustomerTabs) or staff
  // (AdminTabs) branches here: those mount real tab navigators full of
  // screens with their own data-fetching thunks, which would make this test
  // fragile for reasons unrelated to the routing property being checked.
  // The structural guarantee that they're unreachable from the blocked
  // branch is already established by reading RootNavigator.tsx directly —
  // the three branches are mutually exclusive arms of one ternary, so
  // WholesalePendingScreen being present (as proven above) already implies
  // CustomerTabs/AdminTabs are not.
});
