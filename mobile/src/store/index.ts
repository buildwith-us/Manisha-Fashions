import { configureStore } from '@reduxjs/toolkit';
import { setSessionExpiredHandler } from '../api/client';
import authReducer, { sessionExpired } from './slices/authSlice';
import cartReducer, { resetCart } from './slices/cartSlice';
import productReducer, { clearCatalog } from './slices/productSlice';

/**
 * PRD 8.1 — the Redux store is provided at the app root; screens read state
 * with typed hooks and dispatch actions for writes (the functional equivalent
 * of the old Provider context.watch/context.read split).
 */
export const store = configureStore({
  reducer: {
    auth: authReducer,
    product: productReducer,
    cart: cartReducer,
  },
});

/**
 * When the Axios interceptor gives up on refreshing, wipe every slice holding
 * account-scoped data so the next sign-in cannot inherit the old user's cart
 * or catalogue.
 */
setSessionExpiredHandler(() => {
  store.dispatch(sessionExpired());
  store.dispatch(resetCart());
  store.dispatch(clearCatalog());
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
