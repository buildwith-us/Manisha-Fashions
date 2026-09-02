export type AccountType = 'retail' | 'wholesale' | 'staff' | 'admin';
export type WholesaleStatus = 'none' | 'pending' | 'approved' | 'rejected';
export type OrderStatus = 'placed' | 'processing' | 'shipped' | 'delivered' | 'cancelled';
export type PaymentMethod = 'razorpay' | 'cod';
export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded';
export type PriceTier = 'retail' | 'wholesale';
/** Storefront a product is shown in — 'both' is the default. */
export type ProductVisibility = 'both' | 'retail' | 'wholesale';

export interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  meta?: Pagination;
  error?: ApiErrorBody;
}

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: Array<{ field: string; message: string }>;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
}

export interface Address {
  id: string;
  label: string;
  fullName: string;
  phone: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  pincode: string;
  isDefault: boolean;
}

export interface User {
  id: string;
  phone: string;
  name?: string;
  email?: string;
  accountType: AccountType;
  wholesaleStatus: WholesaleStatus;
  business?: {
    businessName?: string;
    gstNumber?: string;
    shopProofUrl?: string;
    appliedAt?: string;
  };
  wholesaleRejectionReason?: string;
  permissions: string[];
  addresses: Address[];
  createdAt: string;
}

export interface AuthResult {
  user: User;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresIn: number;
  refreshTokenExpiresAt: string;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  description?: string;
  image?: string;
  sortOrder: number;
  isActive: boolean;
}

export interface Product {
  id: string;
  name: string;
  description: string;
  category: { id: string; name: string; slug: string } | null;
  images: string[];
  /** Price for the signed-in account's tier, in paise. */
  price: number;
  priceTier: PriceTier;
  retailPrice: number;
  /** Only present for approved wholesale accounts, staff and admin. */
  wholesalePrice?: number;
  stock: number;
  inStock: boolean;
  sku?: string;
  tags: string[];
  isActive: boolean;
  /** Which storefront the product appears in (admin-set). */
  visibility: ProductVisibility;
  /** Aggregate review score; count 0 means "no reviews yet". */
  rating: ProductRating;
  createdAt: string;
  updatedAt: string;
}

export interface CartItem {
  productId: string;
  product: Product;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  stockIssue?: string;
}

export interface Cart {
  items: CartItem[];
  itemCount: number;
  subtotal: number;
  priceTier: PriceTier;
  currency: string;
}

export interface OrderItem {
  productId: string;
  name: string;
  image?: string;
  quantity: number;
  priceAtOrder: number;
  lineTotal: number;
  priceTier: PriceTier;
}

export interface Order {
  id: string;
  orderNumber: string;
  items: OrderItem[];
  shippingAddress: Omit<Address, 'id' | 'label' | 'isDefault'>;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  subtotal: number;
  shippingCharge: number;
  totalAmount: number;
  currency: string;
  orderStatus: OrderStatus;
  statusHistory: Array<{ status: OrderStatus; at: string; note?: string }>;
  cancellable: boolean;
  /**
   * True for a "Buy now" order. The server built it from one product rather
   * than the cart and left the cart intact, so the client must not clear its
   * local copy when this order is placed or paid for.
   */
  fromBuyNow: boolean;
  customer?: { id: string; name?: string; phone: string };
  createdAt: string;
  updatedAt: string;
}

export interface RazorpayHandle {
  razorpayOrderId: string;
  amount: number;
  currency: string;
  keyId: string;
}

export interface CheckoutResult {
  order: Order;
  payment?: RazorpayHandle;
}

export interface DashboardSummary {
  todaysOrders: number;
  todaysRevenue: number;
  pendingWholesaleApprovals: number;
  totalProducts: number;
  lowStockThreshold: number;
  lowStockProducts: Product[];
  ordersByStatus: Partial<Record<OrderStatus, number>>;
}

export interface ProductRating {
  /** Mean of all ratings, one decimal. 0 when there are none. */
  average: number;
  count: number;
}

export interface RatingSummary extends ProductRating {
  /** Counts per star: index 0 = 1★ … index 4 = 5★. */
  breakdown: [number, number, number, number, number];
}

export interface Review {
  id: string;
  rating: number;
  comment?: string;
  verifiedPurchase: boolean;
  /** Display name, or a masked phone when the customer has not set one. */
  author: string;
  /** True for the signed-in viewer's own review. */
  mine: boolean;
  createdAt: string;
}

export interface ProductFilters {
  category?: string;
  search?: string;
  minPrice?: number;
  maxPrice?: number;
  sort: 'newest' | 'price_asc' | 'price_desc' | 'name_asc';
  inStockOnly?: boolean;
}
