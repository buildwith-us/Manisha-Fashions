import { del, get, getPaged, patch, post } from './client';
import type {
  Address,
  AuthResult,
  Cart,
  Category,
  CheckoutResult,
  DashboardSummary,
  Order,
  OrderStatus,
  Pagination,
  Product,
  ProductFilters,
  ProductVisibility,
  RatingSummary,
  Review,
  User,
  WholesaleStatus,
} from './types';

/** Every backend route the app talks to, typed in one place. */

export interface UploadedImage {
  url: string;
  publicId: string;
  width: number;
  height: number;
  format: string;
  bytes: number;
}

export interface StoreConfig {
  currency: string;
  /** Flat COD shipping charge in paise (PRD 4.4). */
  codShippingCharge: number;
  prepaidShippingCharge: number;
  razorpayEnabled: boolean;
  razorpayKeyId: string | null;
  /**
   * True when the API understands "Buy now". Optional because a server that
   * predates the feature simply omits it — and that server would silently
   * check out the whole cart, so its absence has to block the order.
   */
  buyNowSupported?: boolean;
}

export const configApi = {
  get: () => get<StoreConfig>('/config'),
};

/* ── Auth (PRD 4.1 / 8.7) ───────────────────────────────────────────────── */

export const authApi = {
  sendOtp: (phone: string) =>
    post<{ message: string; expiresInSeconds: number; devCode?: string }>('/auth/otp/send', { phone }),

  verifyOtp: (input: {
    phone: string;
    code: string;
    accountType?: 'retail' | 'wholesale';
    application?: { businessName?: string; gstNumber?: string; shopProofUrl?: string };
    deviceId?: string;
  }) => post<AuthResult>('/auth/otp/verify', input),

  refresh: (refreshToken: string) => post<AuthResult>('/auth/refresh', { refreshToken }),

  logout: (refreshToken: string) => post<{ message: string }>('/auth/logout', { refreshToken }),

  me: () => get<User>('/auth/me'),

  updateProfile: (input: { name?: string; email?: string }) => patch<User>('/auth/me', input),

  applyForWholesale: (input: { businessName?: string; gstNumber?: string; shopProofUrl?: string }) =>
    post<User>('/auth/wholesale/apply', input),

  listAddresses: () => get<Address[]>('/auth/addresses'),
  addAddress: (input: Omit<Address, 'id' | 'isDefault'> & { isDefault?: boolean }) =>
    post<Address[]>('/auth/addresses', input),
  updateAddress: (id: string, input: Partial<Omit<Address, 'id'>>) =>
    patch<Address[]>(`/auth/addresses/${id}`, input),
  deleteAddress: (id: string) => del<Address[]>(`/auth/addresses/${id}`),
};

/* ── Catalog (PRD 4.2) ──────────────────────────────────────────────────── */

export const productApi = {
  list: (params: ProductFilters & { page?: number; limit?: number; includeInactive?: boolean }) =>
    getPaged<Product[]>('/products', { params }),

  detail: (id: string) => get<Product>(`/products/${id}`),

  categories: (includeInactive = false) =>
    get<Category[]>('/products/categories', { params: { includeInactive } }),

  create: (input: {
    name: string;
    description: string;
    category: string;
    images?: string[];
    retailPrice: number;
    wholesalePrice: number;
    stock: number;
    sku?: string;
    tags?: string[];
    isActive?: boolean;
    visibility?: ProductVisibility;
  }) => post<Product>('/products', input),

  update: (
    id: string,
    input: Partial<{
      name: string;
      description: string;
      category: string;
      images: string[];
      retailPrice: number;
      wholesalePrice: number;
      stock: number;
      sku: string;
      tags: string[];
      isActive: boolean;
      visibility: ProductVisibility;
    }>,
  ) => patch<Product>(`/products/${id}`, input),

  remove: (id: string) => del<{ message: string }>(`/products/${id}`),

  /* ── Reviews ─────────────────────────────────────────────────────────── */

  reviews: (productId: string, page = 1, limit = 10) =>
    getPaged<{ items: Review[]; summary: RatingSummary }>(`/products/${productId}/reviews`, {
      params: { page, limit },
    }),

  /** Creates or replaces the signed-in customer's review for this product. */
  submitReview: (productId: string, input: { rating: number; comment?: string }) =>
    post<Review>(`/products/${productId}/reviews`, input),

  deleteReview: (productId: string) =>
    del<{ message: string }>(`/products/${productId}/reviews`),

  /**
   * PRD 8.3 — uploads go to Cloudinary via the backend, which returns the
   * secure URLs that get saved onto the product document.
   */
  uploadImages: async (
    files: Array<{ uri: string; name: string; type: string }>,
  ): Promise<UploadedImage[]> => {
    const form = new FormData();
    files.forEach((file) => {
      // React Native's FormData takes this {uri,name,type} shape, not a Blob.
      form.append('images', file as unknown as Blob);
    });

    // Content-Type is deliberately cleared, not set.
    //
    // A multipart body can only be parsed with the `boundary=...` parameter
    // React Native generates from the FormData. Sending a bare
    // "multipart/form-data" suppressed it, and every upload died server-side
    // with 500 "Multipart: Boundary not found" before reaching Cloudinary.
    // Clearing it drops the client's JSON default so the runtime writes the
    // complete header, boundary included.
    return post<UploadedImage[]>('/products/images', form, {
      headers: { 'Content-Type': undefined },
      timeout: 60_000,
    });
  },

  createCategory: (input: { name: string; description?: string; image?: string; sortOrder?: number }) =>
    post<Category>('/products/categories', input),

  updateCategory: (id: string, input: Partial<{ name: string; description: string; isActive: boolean }>) =>
    patch<Category>(`/products/categories/${id}`, input),

  deleteCategory: (id: string) => del<{ message: string }>(`/products/categories/${id}`),
};

/* ── Cart & wishlist (PRD 4.2 / 4.3) ────────────────────────────────────── */

export const cartApi = {
  get: () => get<Cart>('/cart'),
  add: (productId: string, quantity = 1) => post<Cart>('/cart/items', { productId, quantity }),
  updateQuantity: (productId: string, quantity: number) =>
    patch<Cart>(`/cart/items/${productId}`, { quantity }),
  remove: (productId: string) => del<Cart>(`/cart/items/${productId}`),
  clear: () => del<{ message: string }>('/cart'),
};

export const wishlistApi = {
  list: () => get<Product[]>('/wishlist'),
  toggle: (productId: string) =>
    post<{ wishlisted: boolean; items: Product[] }>(`/wishlist/${productId}/toggle`),
};

/* ── Orders (PRD 4.4 / 4.5) ─────────────────────────────────────────────── */

export const orderApi = {
  checkout: (input: {
    addressId: string;
    paymentMethod: 'razorpay' | 'cod';
    /** "Buy now" — order this product alone and leave the saved cart untouched. */
    buyNow?: { productId: string; quantity: number };
  }) => post<CheckoutResult>('/orders/checkout', input),

  confirmPayment: (input: {
    orderId: string;
    razorpayPaymentId: string;
    razorpaySignature: string;
  }) => post<Order>('/orders/payment/confirm', input),

  listMine: (page = 1, limit = 20) =>
    getPaged<Order[]>('/orders', { params: { page, limit } }),

  detail: (id: string) => get<Order>(`/orders/${id}`),

  cancel: (id: string, reason?: string) => post<Order>(`/orders/${id}/cancel`, { reason }),
};

/* ── Admin panel (PRD 4.7 / 8.9) ────────────────────────────────────────── */

export const adminApi = {
  dashboard: () => get<DashboardSummary>('/admin/dashboard'),

  listOrders: (params: { page?: number; limit?: number; status?: OrderStatus; search?: string }) =>
    getPaged<Order[]>('/admin/orders', { params }),

  orderDetail: (id: string) => get<Order>(`/admin/orders/${id}`),

  updateOrderStatus: (id: string, status: OrderStatus, note?: string) =>
    patch<Order>(`/admin/orders/${id}/status`, { status, note }),

  listWholesale: (params: { status?: WholesaleStatus; page?: number; limit?: number }) =>
    getPaged<User[]>('/admin/wholesale', { params }),

  reviewWholesale: (userId: string, decision: 'approved' | 'rejected', reason?: string) =>
    post<User>(`/admin/wholesale/${userId}/review`, { decision, reason }),

  listUsers: (params: { accountType?: string; search?: string; page?: number; limit?: number }) =>
    getPaged<User[]>('/admin/users', { params }),

  setRole: (userId: string, accountType: 'retail' | 'staff' | 'admin') =>
    patch<User>(`/admin/users/${userId}/role`, { accountType }),

  setActive: (userId: string, isActive: boolean) =>
    patch<User>(`/admin/users/${userId}/active`, { isActive }),
};

export type { Pagination };
