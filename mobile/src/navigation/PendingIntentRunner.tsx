import { useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { clearPendingIntent } from '../store/slices/authSlice';
import { addToCart } from '../store/slices/cartSlice';
import { toggleWishlist } from '../store/slices/productSlice';
import { navigationRef } from './navigationRef';

/**
 * Replays whatever a guest was doing when sign-in interrupted them.
 *
 * Renders nothing. Fires once per intent the moment `status` flips to
 * `signedIn`, so the item someone tried to add really does end up in their cart
 * instead of them landing back on Home wondering what happened.
 */
export function PendingIntentRunner() {
  const dispatch = useAppDispatch();
  const isSignedIn = useAppSelector((state) => state.auth.status === 'signedIn');
  const intent = useAppSelector((state) => state.auth.pendingIntent);
  const isStaff = useAppSelector((state) => {
    const type = state.auth.user?.accountType;
    return type === 'admin' || type === 'staff';
  });

  useEffect(() => {
    if (!isSignedIn || !intent) return;

    // Clear first: replaying is one-shot, and a failed action must not loop.
    dispatch(clearPendingIntent());

    // A guest who tapped a customer tab and then signed in as admin lands in the
    // admin stack, where CustomerTabs and Checkout do not exist — replaying
    // would navigate to a route that isn't mounted. Staff keep their own shell.
    if (isStaff) return;

    switch (intent.type) {
      case 'addToCart':
        void dispatch(addToCart({ productId: intent.productId, quantity: intent.quantity }));
        break;
      case 'toggleWishlist':
        void dispatch(toggleWishlist(intent.productId));
        break;
      case 'openTab':
        if (navigationRef.isReady()) {
          navigationRef.navigate('CustomerTabs', { screen: intent.tab });
        }
        break;
      case 'checkout':
        if (navigationRef.isReady()) navigationRef.navigate('Checkout');
        break;
      case 'buyNow':
        if (navigationRef.isReady()) {
          navigationRef.navigate('Checkout', {
            buyNow: { productId: intent.productId, quantity: intent.quantity },
          });
        }
        break;
    }
  }, [dispatch, intent, isSignedIn, isStaff]);

  return null;
}
