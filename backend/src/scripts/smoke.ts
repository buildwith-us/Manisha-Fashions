/**
 * End-to-end smoke test.
 *
 * Boots the real Express app against an in-memory MongoDB (no Docker, no Atlas)
 * and drives the flows the PRD's rules depend on:
 *
 *   - OTP → JWT login and session persistence (8.7)
 *   - wholesalePrice stripped server-side for retail accounts (4.2 / 8.4)
 *   - pending wholesale accounts blocked from browsing (4.1)
 *   - approval unlocking wholesale pricing (4.7)
 *   - staff blocked from changing prices, admin allowed (8.9)
 *   - COD checkout with flat shipping + price-at-order (4.3 / 4.4 / 8.2)
 *   - "Buy now": a single-product order that leaves the saved cart intact
 *   - cancel-while-placed and stock restoration (4.5)
 *   - refresh-token rotation and reuse rejection (8.7 / 8.10)
 *
 * Run with: npm run smoke
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import type { Server } from 'http';

let failures = 0;
let checks = 0;

function check(label: string, condition: boolean, detail?: unknown) {
  checks += 1;
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${label}`);
    if (detail !== undefined) console.error('      got:', JSON.stringify(detail));
  }
}

function section(title: string) {
  console.log(`\n── ${title} ──`);
}

async function main(): Promise<void> {
  const mongod = await MongoMemoryServer.create();

  // Set the environment before anything imports config/env.ts.
  process.env.NODE_ENV = 'development';
  process.env.MONGODB_URI = mongod.getUri('manisha_smoke');
  process.env.PORT = '4599';
  process.env.API_PREFIX = '/api/v1';
  process.env.JWT_ACCESS_SECRET = 'smoke-test-access-secret-value-0123456789';
  process.env.JWT_REFRESH_SECRET = 'smoke-test-refresh-secret-value-0123456789';
  process.env.OTP_PROVIDER = 'console';
  process.env.COD_SHIPPING_CHARGE = '5000';
  process.env.PREPAID_SHIPPING_CHARGE = '0';
  process.env.RATE_LIMIT_GENERAL_PER_MIN = '10000';

  const { createApp } = await import('../app');
  const { connectDatabase, disconnectDatabase } = await import('../config/database');
  const { initStore } = await import('../config/store');
  const { User } = await import('../models/user.model');
  const { Category } = await import('../models/category.model');
  const { Product } = await import('../models/product.model');

  initStore();
  await connectDatabase();

  const app = createApp();
  const server: Server = await new Promise((resolve) => {
    const listener = app.listen(4599, () => resolve(listener));
  });

  const base = 'http://127.0.0.1:4599/api/v1';

  interface ApiResponse<T = any> {
    status: number;
    body: { success: boolean; data?: T; error?: { code: string; message: string }; meta?: any };
  }

  async function call(
    method: string,
    path: string,
    options: { body?: unknown; token?: string } = {},
  ): Promise<ApiResponse> {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    });
    const body = await response.json().catch(() => ({}));
    return { status: response.status, body: body as ApiResponse['body'] };
  }

  /** Full OTP round trip; devCode is returned outside production. */
  async function login(
    phone: string,
    accountType: 'retail' | 'wholesale' = 'retail',
  ): Promise<{ accessToken: string; refreshToken: string; user: any }> {
    const sent = await call('POST', '/auth/otp/send', { body: { phone } });
    const code = sent.body.data?.devCode;
    const verified = await call('POST', '/auth/otp/verify', {
      body: { phone, code, accountType },
    });
    if (!verified.body.data?.accessToken) {
      throw new Error(`Login failed for ${phone}: ${JSON.stringify(verified.body)}`);
    }
    return verified.body.data;
  }

  try {
    /* ── Health ───────────────────────────────────────────────────────── */
    section('Health');
    const health = await call('GET', '/health');
    check('health returns 200 with database connected', health.status === 200, health.body);

    /* ── Auth ─────────────────────────────────────────────────────────── */
    section('Authentication (PRD 4.1 / 8.7)');

    const badVerify = await call('POST', '/auth/otp/verify', {
      body: { phone: '+919000000001', code: '000000' },
    });
    check(
      'wrong/expired OTP returns 401, not 200',
      badVerify.status === 401,
      { status: badVerify.status, body: badVerify.body },
    );

    const sendResult = await call('POST', '/auth/otp/send', { body: { phone: '9812345670' } });
    check('bare 10-digit number is accepted and normalised', sendResult.status === 200);

    const retail = await login('+919812345671', 'retail');
    check('retail signup issues an access token', Boolean(retail.accessToken));
    check('retail account type is retail', retail.user.accountType === 'retail', retail.user);

    // Catalog reads are open to signed-out guests (guest-first entry): the
    // serializer treats an absent viewer as retail and strips wholesalePrice,
    // so browsing without a token is allowed by design.
    const guestBrowse = await call('GET', '/products');
    check('a signed-out guest can browse the catalogue', guestBrowse.status === 200, guestBrowse.body);

    // Guest access is read-only — anything behind a real permission still 401s.
    const noToken = await call('GET', '/cart');
    check('protected route without a token returns 401', noToken.status === 401, noToken.body);

    /* ── Admin + catalog ──────────────────────────────────────────────── */
    section('Catalog & price visibility (PRD 4.2 / 8.4)');

    await User.updateOne({ phone: '+919999999901' }, { $set: { accountType: 'admin' } }, { upsert: true });
    const adminUser = await User.findOne({ phone: '+919999999901' });
    if (adminUser) {
      adminUser.accountType = 'admin';
      await adminUser.save();
    }
    const admin = await login('+919999999901');
    check('admin routed by accountType', admin.user.accountType === 'admin', admin.user);

    const categoryResponse = await call('POST', '/products/categories', {
      token: admin.accessToken,
      body: { name: 'Necklaces', description: 'Chains and chokers' },
    });
    check('admin can create a category', categoryResponse.status === 201, categoryResponse.body);
    const categoryId = categoryResponse.body.data?.id;

    const productResponse = await call('POST', '/products', {
      token: admin.accessToken,
      body: {
        name: 'Kundan Bridal Set',
        description: 'Handcrafted kundan necklace set.',
        category: categoryId,
        retailPrice: 499900,
        wholesalePrice: 325000,
        stock: 10,
        tags: ['kundan'],
      },
    });
    check('admin can create a product', productResponse.status === 201, productResponse.body);
    const productId = productResponse.body.data?.id;
    check(
      'admin sees wholesalePrice',
      productResponse.body.data?.wholesalePrice === 325000,
      productResponse.body.data,
    );

    const retailList = await call('GET', '/products', { token: retail.accessToken });
    const retailProduct = retailList.body.data?.[0];
    check('retail can browse the catalog', retailList.status === 200);
    check(
      'wholesalePrice is absent for retail accounts',
      retailProduct !== undefined && !('wholesalePrice' in retailProduct),
      retailProduct,
    );
    check(
      'retail price tier is retail',
      retailProduct?.price === 499900 && retailProduct?.priceTier === 'retail',
      retailProduct,
    );

    const retailDetail = await call('GET', `/products/${productId}`, { token: retail.accessToken });
    check(
      'wholesalePrice is absent on the detail endpoint too',
      !('wholesalePrice' in (retailDetail.body.data ?? {})),
      retailDetail.body.data,
    );

    /* ── Wholesale gating ─────────────────────────────────────────────── */
    section('Wholesale approval gate (PRD 4.1 / 4.7)');

    const wholesale = await login('+919812345672', 'wholesale');
    check(
      'wholesale signup starts pending',
      wholesale.user.wholesaleStatus === 'pending',
      wholesale.user,
    );

    const pendingBrowse = await call('GET', '/products', { token: wholesale.accessToken });
    check(
      'pending wholesale is blocked from browsing with 403',
      pendingBrowse.status === 403 && pendingBrowse.body.error?.code === 'WHOLESALE_NOT_APPROVED',
      pendingBrowse.body,
    );

    const pendingList = await call('GET', '/admin/wholesale?status=pending', {
      token: admin.accessToken,
    });
    check(
      'admin sees the pending application',
      pendingList.status === 200 && pendingList.body.data?.length === 1,
      pendingList.body,
    );

    const approve = await call('POST', `/admin/wholesale/${wholesale.user.id}/review`, {
      token: admin.accessToken,
      body: { decision: 'approved' },
    });
    check('admin can approve', approve.status === 200 && approve.body.data?.wholesaleStatus === 'approved', approve.body);

    // The same access token is reused: authenticate() re-reads the user, so the
    // new permissions apply without a re-login.
    const approvedList = await call('GET', '/products', { token: wholesale.accessToken });
    const wholesaleProduct = approvedList.body.data?.[0];
    check('approved wholesale can browse', approvedList.status === 200, approvedList.body);
    check(
      'approved wholesale sees wholesalePrice',
      wholesaleProduct?.wholesalePrice === 325000,
      wholesaleProduct,
    );
    check(
      'approved wholesale is charged the wholesale tier',
      wholesaleProduct?.price === 325000 && wholesaleProduct?.priceTier === 'wholesale',
      wholesaleProduct,
    );

    /* ── Staff pricing guard ──────────────────────────────────────────── */
    section('Staff vs admin permissions (PRD 8.9)');

    await User.create({ phone: '+919812345673', accountType: 'staff' });
    const staff = await login('+919812345673');
    check('staff account type resolved', staff.user.accountType === 'staff', staff.user);

    const staffPriceChange = await call('PATCH', `/products/${productId}`, {
      token: staff.accessToken,
      body: { retailPrice: 100 },
    });
    check(
      'staff cannot change pricing (403)',
      staffPriceChange.status === 403,
      staffPriceChange.body,
    );

    const staffStockChange = await call('PATCH', `/products/${productId}`, {
      token: staff.accessToken,
      body: { stock: 25 },
    });
    check('staff can still manage stock', staffStockChange.status === 200, staffStockChange.body);

    const staffApproval = await call('GET', '/admin/wholesale', { token: staff.accessToken });
    check('staff cannot access wholesale approvals (403)', staffApproval.status === 403, staffApproval.body);

    /* ── Cart + COD checkout ──────────────────────────────────────────── */
    section('Cart & COD checkout (PRD 4.3 / 4.4 / 8.2)');

    const addToCart = await call('POST', '/cart/items', {
      token: retail.accessToken,
      body: { productId, quantity: 2 },
    });
    check('retail can add to cart', addToCart.status === 200, addToCart.body);
    check(
      'cart totals use the retail tier',
      addToCart.body.data?.subtotal === 999800,
      addToCart.body.data,
    );

    const address = await call('POST', '/auth/addresses', {
      token: retail.accessToken,
      body: {
        fullName: 'Test Buyer',
        phone: '9812345671',
        line1: '12 MG Road',
        city: 'Pune',
        state: 'Maharashtra',
        pincode: '411001',
      },
    });
    check('address saved and defaulted', address.body.data?.[0]?.isDefault === true, address.body.data);
    const addressId = address.body.data?.[0]?.id;

    const codOrder = await call('POST', '/orders/checkout', {
      token: retail.accessToken,
      body: { addressId, paymentMethod: 'cod' },
    });
    check('COD checkout succeeds', codOrder.status === 201, codOrder.body);
    check(
      'COD adds the flat shipping charge',
      codOrder.body.data?.order?.shippingCharge === 5000,
      codOrder.body.data?.order,
    );
    check(
      'order total = subtotal + shipping',
      codOrder.body.data?.order?.totalAmount === 999800 + 5000,
      codOrder.body.data?.order,
    );
    check(
      'priceAtOrder is frozen onto the line item',
      codOrder.body.data?.order?.items?.[0]?.priceAtOrder === 499900,
      codOrder.body.data?.order?.items,
    );

    const stockAfter = await Product.findById(productId);
    check('stock decremented by the ordered quantity', stockAfter?.stock === 23, stockAfter?.stock);

    const cartAfter = await call('GET', '/cart', { token: retail.accessToken });
    check('cart cleared after a COD order', cartAfter.body.data?.items?.length === 0, cartAfter.body.data);

    /* ── Price protection ─────────────────────────────────────────────── */
    section('Price protection (PRD 8.2)');

    await call('PATCH', `/products/${productId}`, {
      token: admin.accessToken,
      body: { retailPrice: 599900 },
    });
    const orderId = codOrder.body.data?.order?.id;
    const orderAfterPriceChange = await call('GET', `/orders/${orderId}`, {
      token: retail.accessToken,
    });
    check(
      'historical order keeps its original price after a catalog change',
      orderAfterPriceChange.body.data?.items?.[0]?.priceAtOrder === 499900,
      orderAfterPriceChange.body.data?.items,
    );

    /* ── Order lifecycle ──────────────────────────────────────────────── */
    section('Order lifecycle (PRD 4.5)');

    const otherUser = await login('+919812345674');
    const crossRead = await call('GET', `/orders/${orderId}`, { token: otherUser.accessToken });
    check('a customer cannot read another customer\'s order', crossRead.status === 404, crossRead.body);

    const badTransition = await call('PATCH', `/admin/orders/${orderId}/status`, {
      token: staff.accessToken,
      body: { status: 'delivered' },
    });
    check(
      'placed → delivered is rejected as an invalid transition',
      badTransition.status === 409,
      badTransition.body,
    );

    const cancel = await call('POST', `/orders/${orderId}/cancel`, {
      token: retail.accessToken,
      body: { reason: 'Changed my mind' },
    });
    check('customer can cancel while placed', cancel.body.data?.orderStatus === 'cancelled', cancel.body);

    const stockRestored = await Product.findById(productId);
    check('stock restored on cancellation', stockRestored?.stock === 25, stockRestored?.stock);

    const secondOrder = await call('POST', '/orders/checkout', {
      token: retail.accessToken,
      body: { addressId, paymentMethod: 'cod' },
    });
    check('checkout with an empty cart is rejected', secondOrder.status === 400, secondOrder.body);

    await call('POST', '/cart/items', {
      token: retail.accessToken,
      body: { productId, quantity: 1 },
    });
    const order2 = await call('POST', '/orders/checkout', {
      token: retail.accessToken,
      body: { addressId, paymentMethod: 'cod' },
    });
    const order2Id = order2.body.data?.order?.id;
    await call('PATCH', `/admin/orders/${order2Id}/status`, {
      token: staff.accessToken,
      body: { status: 'processing' },
    });
    const lateCancel = await call('POST', `/orders/${order2Id}/cancel`, {
      token: retail.accessToken,
    });
    check(
      'cancellation is refused once processing has begun',
      lateCancel.status === 409,
      lateCancel.body,
    );

    /* ── Stock guard ──────────────────────────────────────────────────── */
    section('Stock guard');

    // Above the remaining stock but inside the validator's 1–999 range, so the
    // request reaches the controller and exercises the real stock guard.
    const overOrder = await call('POST', '/cart/items', {
      token: retail.accessToken,
      body: { productId, quantity: 900 },
    });
    check('cannot add more than the available stock', overOrder.status === 409, overOrder.body);

    const overValidator = await call('POST', '/cart/items', {
      token: retail.accessToken,
      body: { productId, quantity: 9999 },
    });
    check(
      'an out-of-range quantity is rejected by validation before the controller',
      overValidator.status === 422,
      overValidator.body,
    );

    /* ── Buy now ──────────────────────────────────────────────────────── */
    section('Buy now — one product, cart untouched');

    // The client refuses to place a Buy-now order unless the server says it
    // understands the field, because an older server would strip it and bill
    // the whole cart with no visible error.
    const buyNowConfig = await call('GET', '/config', { token: retail.accessToken });
    check(
      'config advertises Buy-now support',
      buyNowConfig.body.data?.buyNowSupported === true,
      buyNowConfig.body.data,
    );

    // A cart that has to survive the Buy-now order completely unchanged. This
    // is the whole point of the feature: without it, "Buy now" would bill the
    // customer for everything they had saved.
    await call('POST', '/cart/items', {
      token: retail.accessToken,
      body: { productId, quantity: 2 },
    });
    const cartBeforeBuyNow = await call('GET', '/cart', { token: retail.accessToken });
    check(
      'the cart holds 2 pieces before Buy now',
      cartBeforeBuyNow.body.data?.itemCount === 2,
      cartBeforeBuyNow.body.data,
    );

    // Read live rather than hardcoded: an earlier section repriced this product.
    const productBeforeBuyNow = await Product.findById(productId);
    const stockBeforeBuyNow = productBeforeBuyNow?.stock ?? 0;
    const buyNowUnitPrice = productBeforeBuyNow?.retailPrice ?? 0;

    const buyNowOrder = await call('POST', '/orders/checkout', {
      token: retail.accessToken,
      body: { addressId, paymentMethod: 'cod', buyNow: { productId, quantity: 1 } },
    });
    check('Buy now checkout succeeds', buyNowOrder.status === 201, buyNowOrder.body);
    check(
      'the order holds only the bought product, at the bought quantity',
      buyNowOrder.body.data?.order?.items?.length === 1 &&
        buyNowOrder.body.data?.order?.items?.[0]?.quantity === 1,
      buyNowOrder.body.data?.order?.items,
    );
    check(
      'the total is that one line plus shipping, not the cart',
      buyNowOrder.body.data?.order?.totalAmount === buyNowUnitPrice + 5000,
      buyNowOrder.body.data?.order,
    );
    check(
      'the order is flagged fromBuyNow so payment does not clear the cart',
      buyNowOrder.body.data?.order?.fromBuyNow === true,
      buyNowOrder.body.data?.order,
    );

    const cartAfterBuyNow = await call('GET', '/cart', { token: retail.accessToken });
    check(
      'the saved cart is untouched by a Buy-now order',
      cartAfterBuyNow.body.data?.itemCount === 2,
      cartAfterBuyNow.body.data,
    );

    const stockAfterBuyNow = (await Product.findById(productId))?.stock ?? 0;
    check('stock falls by the bought quantity only', stockAfterBuyNow === stockBeforeBuyNow - 1, {
      before: stockBeforeBuyNow,
      after: stockAfterBuyNow,
    });

    const buyNowOverStock = await call('POST', '/orders/checkout', {
      token: retail.accessToken,
      body: { addressId, paymentMethod: 'cod', buyNow: { productId, quantity: 900 } },
    });
    check(
      'Buy now cannot order more than the available stock',
      buyNowOverStock.status === 409,
      buyNowOverStock.body,
    );

    const buyNowUnknown = await call('POST', '/orders/checkout', {
      token: retail.accessToken,
      body: {
        addressId,
        paymentMethod: 'cod',
        buyNow: { productId: '0123456789abcdef01234567', quantity: 1 },
      },
    });
    check(
      'Buy now on a product that does not exist is refused',
      buyNowUnknown.status === 409,
      buyNowUnknown.body,
    );

    const stockAfterFailures = (await Product.findById(productId))?.stock ?? 0;
    check(
      'a refused Buy now reserves no stock',
      stockAfterFailures === stockAfterBuyNow,
      { expected: stockAfterBuyNow, got: stockAfterFailures },
    );

    /* ── Session persistence ──────────────────────────────────────────── */
    section('Session persistence & refresh rotation (PRD 8.7 / 8.10)');

    const refreshed = await call('POST', '/auth/refresh', {
      body: { refreshToken: retail.refreshToken },
    });
    check('refresh returns a new token pair', refreshed.status === 200 && Boolean(refreshed.body.data?.accessToken), refreshed.body);

    const meWithNew = await call('GET', '/auth/me', { token: refreshed.body.data?.accessToken });
    check('the refreshed access token works', meWithNew.status === 200, meWithNew.body);

    const reuseOld = await call('POST', '/auth/refresh', {
      body: { refreshToken: retail.refreshToken },
    });
    check('the rotated-away refresh token is rejected', reuseOld.status === 401, reuseOld.body);

    const logoutResponse = await call('POST', '/auth/logout', {
      body: { refreshToken: refreshed.body.data?.refreshToken },
    });
    check('logout succeeds', logoutResponse.status === 200);

    const afterLogout = await call('POST', '/auth/refresh', {
      body: { refreshToken: refreshed.body.data?.refreshToken },
    });
    check('refresh after logout is rejected server-side', afterLogout.status === 401, afterLogout.body);

    /* ── Validation ───────────────────────────────────────────────────── */
    section('Validation (PRD 8.11)');

    const badProduct = await call('POST', '/products', {
      token: admin.accessToken,
      body: { name: 'x', description: '', category: 'not-an-id', retailPrice: -5, wholesalePrice: 1, stock: -1 },
    });
    check('malformed product payload returns 422', badProduct.status === 422, badProduct.body);

    const wholesaleAboveRetail = await call('POST', '/products', {
      token: admin.accessToken,
      body: {
        name: 'Bad price product',
        description: 'Wholesale above retail',
        category: categoryId,
        retailPrice: 1000,
        wholesalePrice: 5000,
        stock: 1,
      },
    });
    check(
      'wholesale price above retail price is rejected',
      wholesaleAboveRetail.status === 422,
      wholesaleAboveRetail.body,
    );

    /* ── Dashboard ────────────────────────────────────────────────────── */
    section('Admin dashboard (PRD 4.7)');

    const dashboard = await call('GET', '/admin/dashboard', { token: admin.accessToken });
    check('dashboard returns today\'s orders and pending approvals', dashboard.status === 200, dashboard.body);
    check(
      'dashboard reports low stock products',
      Array.isArray(dashboard.body.data?.lowStockProducts),
      dashboard.body.data,
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await disconnectDatabase();
    await mongod.stop();
  }

  console.log(`\n${'='.repeat(52)}`);
  console.log(`${checks - failures}/${checks} checks passed`);
  console.log('='.repeat(52));

  if (failures > 0) process.exit(1);
}

main().catch((error) => {
  console.error('Smoke test crashed:', error);
  process.exit(1);
});
