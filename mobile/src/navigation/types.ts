import type { NavigatorScreenParams } from '@react-navigation/native';
import type { OrderStatus, RazorpayHandle } from '../api/types';

export type CustomerTabParamList = {
  Catalog: undefined;
  Wishlist: undefined;
  Cart: undefined;
  Orders: undefined;
  Account: undefined;
};

export type AdminTabParamList = {
  Dashboard: undefined;
  Manage: undefined;
  AdminOrders: { status?: OrderStatus } | undefined;
  Wholesale: undefined;
  Account: undefined;
};

export type RootStackParamList = {
  // Auth
  Login: undefined;
  Otp: undefined;
  WholesalePending: undefined;
  ForgotPassword: undefined;
  /** Entry for the 6-digit code emailed by /auth/forgot-password. */
  ResetOtp: { email: string };
  /** Token comes from /auth/verify-reset-otp, not from an email link. */
  ResetPassword: { token: string };

  // Shells
  CustomerTabs: NavigatorScreenParams<CustomerTabParamList>;
  AdminTabs: NavigatorScreenParams<AdminTabParamList>;

  // Customer
  ProductDetail: { productId: string };
  Filters: undefined;
  /**
   * No params is the ordinary cart checkout. `buyNow` switches the screen to a
   * single-product order that leaves the saved cart untouched.
   */
  Checkout: { buyNow?: { productId: string; quantity: number } } | undefined;
  RazorpayCheckout: { orderId: string; handle: RazorpayHandle };
  OrderConfirmation: { orderId: string };
  OrderDetail: { orderId: string };
  Addresses: { selectMode?: boolean } | undefined;
  AddressForm: { addressId?: string } | undefined;
  Profile: undefined;

  // Admin
  AdminProductForm: { productId?: string } | undefined;
  AdminCategories: undefined;
  AdminOrderDetail: { orderId: string };
  AdminUsers: undefined;
};

declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
