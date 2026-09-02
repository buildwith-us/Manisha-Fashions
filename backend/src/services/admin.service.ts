import { Order } from '../models/order.model';
import { User } from '../models/user.model';
import * as productRepository from '../repositories/product.repository';
import { serializeProducts } from '../serializers/product.serializer';
import { serializeUser, type SerializedUser } from '../serializers/user.serializer';
import { ApiError } from '../utils/ApiError';
import type { AuthenticatedUser, WholesaleStatus } from '../types';
import * as tokenService from './token.service';

const LOW_STOCK_THRESHOLD = 5;

/** India has no daylight saving, so the day boundary is a fixed offset. */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/**
 * Midnight as the shop counts it.
 *
 * `new Date().setHours(0, 0, 0, 0)` reads the server's clock, and the server
 * runs in UTC — so "today" would roll over at 5:30am in the shop, and every
 * morning until then the dashboard would report yesterday's orders and takings
 * as today's.
 */
function startOfDayInIst(): Date {
  const nowInIst = new Date(Date.now() + IST_OFFSET_MS);
  nowInIst.setUTCHours(0, 0, 0, 0);
  return new Date(nowInIst.getTime() - IST_OFFSET_MS);
}

/** PRD 4.7 — basic dashboard: today's orders, pending approvals, low stock. */
export async function getDashboard(viewer: AuthenticatedUser) {
  const startOfDay = startOfDayInIst();

  const [
    todaysOrders,
    todaysRevenueAgg,
    pendingApprovals,
    lowStock,
    totalProducts,
    ordersByStatus,
  ] = await Promise.all([
    Order.countDocuments({ createdAt: { $gte: startOfDay } }),
    Order.aggregate<{ _id: null; total: number }>([
      {
        $match: {
          createdAt: { $gte: startOfDay },
          orderStatus: { $ne: 'cancelled' },
        },
      },
      { $group: { _id: null, total: { $sum: '$totalAmount' } } },
    ]),
    User.countDocuments({ accountType: 'wholesale', wholesaleStatus: 'pending' }),
    productRepository.findLowStock(LOW_STOCK_THRESHOLD, 10),
    productRepository.countAll(true),
    Order.aggregate<{ _id: string; count: number }>([
      { $group: { _id: '$orderStatus', count: { $sum: 1 } } },
    ]),
  ]);

  return {
    todaysOrders,
    todaysRevenue: todaysRevenueAgg[0]?.total ?? 0,
    pendingWholesaleApprovals: pendingApprovals,
    totalProducts,
    lowStockThreshold: LOW_STOCK_THRESHOLD,
    lowStockProducts: serializeProducts(lowStock, viewer),
    ordersByStatus: Object.fromEntries(ordersByStatus.map((row) => [row._id, row.count])),
  };
}

/* ── Wholesale approvals (PRD 4.7) ──────────────────────────────────────── */

export async function listWholesaleApplications(filters: {
  status?: WholesaleStatus;
  page: number;
  limit: number;
}) {
  const query: Record<string, unknown> = { accountType: 'wholesale' };
  if (filters.status) query.wholesaleStatus = filters.status;

  const skip = (filters.page - 1) * filters.limit;
  const [users, total] = await Promise.all([
    User.find(query).sort({ 'business.appliedAt': -1, createdAt: -1 }).skip(skip).limit(filters.limit),
    User.countDocuments(query),
  ]);

  return {
    items: users.map(serializeUser),
    pagination: {
      page: filters.page,
      limit: filters.limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / filters.limit)),
      hasMore: filters.page * filters.limit < total,
    },
  };
}

export async function reviewWholesaleApplication(
  actor: AuthenticatedUser,
  userId: string,
  decision: 'approved' | 'rejected',
  reason?: string,
): Promise<SerializedUser> {
  const user = await User.findById(userId);
  if (!user) throw ApiError.notFound('Account not found');
  if (user.accountType !== 'wholesale') {
    throw ApiError.badRequest('This account has not applied for wholesale pricing.');
  }
  if (user.wholesaleStatus === decision) {
    throw ApiError.conflict(`This application is already ${decision}.`);
  }

  user.wholesaleStatus = decision;
  user.wholesaleReview = {
    reviewedBy: actor.id as never,
    reviewedAt: new Date(),
    reason,
  };
  await user.save();

  // The user's permission set changes with this decision. Their existing access
  // token still carries the old claims, but authenticate() re-reads the user on
  // every request, so the change takes effect immediately.
  return serializeUser(user);
}

/* ── Customer / staff accounts (PRD 8.9 — admin only) ───────────────────── */

export async function listUsers(filters: {
  accountType?: string;
  search?: string;
  page: number;
  limit: number;
}) {
  const query: Record<string, unknown> = {};
  if (filters.accountType) query.accountType = filters.accountType;
  if (filters.search) {
    const pattern = new RegExp(filters.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    query.$or = [{ phone: pattern }, { name: pattern }, { 'business.businessName': pattern }];
  }

  const skip = (filters.page - 1) * filters.limit;
  const [users, total] = await Promise.all([
    User.find(query).sort({ createdAt: -1 }).skip(skip).limit(filters.limit),
    User.countDocuments(query),
  ]);

  return {
    items: users.map(serializeUser),
    pagination: {
      page: filters.page,
      limit: filters.limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / filters.limit)),
      hasMore: filters.page * filters.limit < total,
    },
  };
}

/**
 * Promotes or demotes a staff account. Admin-only (PRD 8.9: staff cannot manage
 * staff/admin accounts). Changing a role revokes that user's sessions so the
 * new permission set is picked up on a fresh sign-in.
 */
export async function setAccountRole(
  actor: AuthenticatedUser,
  userId: string,
  accountType: 'retail' | 'staff' | 'admin',
): Promise<SerializedUser> {
  if (userId === actor.id) {
    throw ApiError.badRequest('You cannot change your own role.');
  }

  const user = await User.findById(userId);
  if (!user) throw ApiError.notFound('Account not found');

  user.accountType = accountType;
  // None of the assignable roles carry wholesale pricing — that is granted only
  // through the approval flow — so any prior wholesale state is cleared.
  user.wholesaleStatus = 'none';
  await user.save();
  await tokenService.revokeAllSessions(user._id);

  return serializeUser(user);
}

export async function setAccountActive(
  actor: AuthenticatedUser,
  userId: string,
  isActive: boolean,
): Promise<SerializedUser> {
  if (userId === actor.id) {
    throw ApiError.badRequest('You cannot deactivate your own account.');
  }

  const user = await User.findById(userId);
  if (!user) throw ApiError.notFound('Account not found');

  user.isActive = isActive;
  await user.save();
  if (!isActive) await tokenService.revokeAllSessions(user._id);

  return serializeUser(user);
}
