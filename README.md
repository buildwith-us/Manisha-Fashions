# 💎 Manisha Fashions — Jewellery Ecommerce App

> A full-stack jewellery ecommerce platform with **dual-pricing** (retail & wholesale), **role-based access**, and an **in-app admin panel** — built for a real jewellery business.

![Node.js](https://img.shields.io/badge/Node.js-≥20-339933?logo=nodedotjs&logoColor=white)
![Expo](https://img.shields.io/badge/Expo_SDK-57-000020?logo=expo&logoColor=white)
![React Native](https://img.shields.io/badge/React_Native-0.86-61DAFB?logo=react&logoColor=black)
![MongoDB](https://img.shields.io/badge/MongoDB-Mongoose-47A248?logo=mongodb&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-Strict-3178C6?logo=typescript&logoColor=white)

---

## 📦 Packages

| Package | Stack | Description |
| --- | --- | --- |
| [`backend/`](backend/) | Node.js · Express · TypeScript · MongoDB (Mongoose) | REST API — auth, catalog, cart, orders, payments, admin |
| [`mobile/`](mobile/) | Expo SDK 57 · React Native 0.86 · TypeScript · Redux Toolkit · React Navigation | Android + iOS client — customer flow & in-app admin panel |

---

## ✨ Key Features

### Customer
- 🔐 **OTP-based authentication** — phone login with MSG91 / console dev mode
- 🛍️ **Product catalog** — categories, search, filters, sort, wishlist
- 🛒 **Cart & checkout** — add to cart or "Buy Now" for instant single-product orders
- 💰 **Dual pricing** — retail and wholesale (wholesale visible only to approved accounts)
- 💳 **Payments** — COD and Razorpay online (WebView-based, works in Expo Go)
- 📦 **Order tracking** — real-time status updates, cancellation support
- 📍 **Address management** — save multiple delivery addresses

### Admin & Staff
- 📊 **Dashboard** — sales overview and key metrics
- 📋 **Product management** — CRUD with Cloudinary image upload
- 👥 **User management** — wholesale approvals, staff accounts
- 📦 **Order management** — status updates, filtering
- 🏷️ **Category management** — organize product catalog

### Security & Architecture
- 🔑 **JWT with refresh token rotation** — stored in Keychain / Keystore via `expo-secure-store`
- 🛡️ **RBAC** — five roles (retail, wholesale pending/approved, staff, admin) enforced server-side
- 💲 **Server-side price stripping** — wholesale prices never leak to retail clients
- ✅ **Zod validation** — all request payloads validated
- 🚦 **Rate limiting** — per-endpoint throttling
- 🔒 **HMAC-verified webhooks** — Razorpay payment confirmation

---

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────────┐
│                    Mobile App                        │
│        Expo SDK 57 · React Native 0.86               │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐   │
│  │  Screens │  │  Redux   │  │  React Navigation│   │
│  │ (Customer│  │ Toolkit  │  │  (Stack + Tab)   │   │
│  │  Admin   │  │  Store   │  │                  │   │
│  │  Auth)   │  │          │  │                  │   │
│  └────┬─────┘  └────┬─────┘  └──────────────────┘   │
│       └──────┬───────┘                               │
│              ▼                                       │
│     Axios Client (auto-attach JWT, refresh on 401)   │
└──────────────────┬───────────────────────────────────┘
                   │ HTTPS
                   ▼
┌──────────────────────────────────────────────────────┐
│                   Backend API                        │
│          Node.js · Express · TypeScript               │
│                                                      │
│  Request → Zod Validate → Rate Limit → JWT Auth      │
│    → RBAC Authorize → Controller → Service           │
│    → Repository → MongoDB                            │
│    → Serializer (price stripping) → JSON Response    │
│                                                      │
│  Integrations:                                       │
│    ☁️  Cloudinary (images)                            │
│    💳 Razorpay (payments + webhook)                  │
│    📱 MSG91 (OTP SMS)                                │
└──────────────────────────────────────────────────────┘
```

---

## 🚀 Quick Start

### Prerequisites

- **Node.js** ≥ 20
- **MongoDB** (Docker, local, or Atlas)
- **Expo CLI** (`npx expo`)

### 1. Start MongoDB

```bash
# Via Docker (recommended)
docker compose up -d

# Or point .env at your Atlas connection string
```

### 2. Backend

```bash
cd backend
cp .env.example .env      # fill in secrets — see "Configuration"
npm install
npm run seed              # categories, sample products, admin account
npm run dev               # → http://localhost:4000/api/v1
```

> `npm run seed` prints the admin phone number (`SEED_ADMIN_PHONE`, default `+919999999999`). Sign in with it to access the admin panel.

> With `OTP_PROVIDER=console` the OTP is printed to the server log **and** returned in the API response as `devCode`, so the app auto-fills it. This is disabled in production.

### 3. Mobile

```bash
cd mobile
npm install
npx expo start
```

The app resolves its API base URL in this order:

1. `extra.apiUrl` in [`mobile/app.json`](mobile/app.json)
2. `EXPO_PUBLIC_API_URL` env variable
3. Platform default — `http://10.0.2.2:4000/api/v1` (Android emulator) or `http://localhost:4000/api/v1` (elsewhere)

> **Expo Go compatible** — no native modules required. `npx expo run:android` / `run:ios` also works for local builds.

---

## ✅ Verification

```bash
# Backend type check
cd backend && npm run typecheck

# Smoke tests (in-memory MongoDB — no Docker needed)
npm run smoke

# Full audit (every endpoint, every role)
npm run audit

# Mobile type check
cd mobile && npx tsc --noEmit
```

`npm run smoke` boots Express against an **in-memory MongoDB** and asserts end-to-end:

- OTP → JWT login; wrong/expired code returns 401
- `wholesalePrice` absent from retail responses
- Pending wholesale account blocked (403 `WHOLESALE_NOT_APPROVED`)
- Approval unlocks wholesale pricing on the existing token
- Staff refused price changes but allowed stock changes
- COD checkout adds flat shipping charge; `priceAtOrder` is frozen
- Cancelling "placed" order restores stock; "processing" cancellation refused
- Refresh-token rotation works; reused token rejected

> First run downloads a `mongod` binary (~270 MB) and is slow; subsequent runs are fast.

---

## ⚙️ Configuration

All config lives in `backend/.env` (never committed). See [`backend/.env.example`](backend/.env.example) for the full list.

| Group | Keys | Notes |
| --- | --- | --- |
| **Database** | `MONGODB_URI` | MongoDB Atlas M0 is sufficient at launch |
| **JWT** | `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `JWT_ACCESS_TTL`, `JWT_REFRESH_TTL_DAYS` | Long random values. Refresh TTL = admin-configurable idle period (default 90 days) |
| **OTP** | `OTP_PROVIDER`, `MSG91_*` | `console` (dev), `msg91` (live). See OTP Providers below |
| **Images** | `CLOUDINARY_*` | Without these, image upload returns 503; everything else works |
| **Payments** | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | Without these only COD is offered — the app hides the online option |
| **Commerce** | `COD_SHIPPING_CHARGE`, `PREPAID_SHIPPING_CHARGE` | **Integer paise** (`5000` = ₹50). Served to the app via `GET /config` |

> Every integration degrades gracefully — the API boots and reports what is wired up at `GET /api/v1/health`.

### OTP Providers

| Provider | When to use |
| --- | --- |
| `console` | **Development only.** Returns OTP in the API response. Refused in production. |
| `msg91` | **Production.** Requires `MSG91_AUTH_KEY`, `MSG91_SENDER_ID`, `MSG91_TEMPLATE_ID`. |
| `firebase` | Returns 503 with an explanation — Firebase Phone Auth verifies on the client, so the server never sends the OTP. |

**Test numbers** (while SMS isn't live):

| Number | Role |
| --- | --- |
| `9363750806`, `9345548984` | **Admin** — shop's own handsets |
| `9000000001` | **Retail** customer |
| `9000000002` | **Wholesale** — starts pending approval |

No SIM needed — the console provider returns the code in the API response and the app auto-fills it.

To go live: set `OTP_PROVIDER=msg91` **and** the three `MSG91_*` keys.

---

## 📱 App Screens

### Customer Flow
| Screen | File |
| --- | --- |
| Product Catalog | [`CatalogScreen.tsx`](mobile/src/screens/customer/CatalogScreen.tsx) |
| Product Detail | [`ProductDetailScreen.tsx`](mobile/src/screens/customer/ProductDetailScreen.tsx) |
| Cart | [`CartScreen.tsx`](mobile/src/screens/customer/CartScreen.tsx) |
| Checkout | [`CheckoutScreen.tsx`](mobile/src/screens/customer/CheckoutScreen.tsx) |
| Razorpay Payment | [`RazorpayCheckoutScreen.tsx`](mobile/src/screens/customer/RazorpayCheckoutScreen.tsx) |
| Order Confirmation | [`OrderConfirmationScreen.tsx`](mobile/src/screens/customer/OrderConfirmationScreen.tsx) |
| Orders List | [`OrdersScreen.tsx`](mobile/src/screens/customer/OrdersScreen.tsx) |
| Order Detail | [`OrderDetailScreen.tsx`](mobile/src/screens/customer/OrderDetailScreen.tsx) |
| Wishlist | [`WishlistScreen.tsx`](mobile/src/screens/customer/WishlistScreen.tsx) |
| Addresses | [`AddressesScreen.tsx`](mobile/src/screens/customer/AddressesScreen.tsx) |
| Address Form | [`AddressFormScreen.tsx`](mobile/src/screens/customer/AddressFormScreen.tsx) |
| Filters | [`FiltersScreen.tsx`](mobile/src/screens/customer/FiltersScreen.tsx) |

### Admin Panel
| Screen | File |
| --- | --- |
| Dashboard | [`AdminDashboardScreen.tsx`](mobile/src/screens/admin/AdminDashboardScreen.tsx) |
| Products | [`AdminProductsScreen.tsx`](mobile/src/screens/admin/AdminProductsScreen.tsx) |
| Product Form | [`AdminProductFormScreen.tsx`](mobile/src/screens/admin/AdminProductFormScreen.tsx) |
| Categories | [`AdminCategoriesScreen.tsx`](mobile/src/screens/admin/AdminCategoriesScreen.tsx) |
| Orders | [`AdminOrdersScreen.tsx`](mobile/src/screens/admin/AdminOrdersScreen.tsx) |
| Order Detail | [`AdminOrderDetailScreen.tsx`](mobile/src/screens/admin/AdminOrderDetailScreen.tsx) |
| Users | [`AdminUsersScreen.tsx`](mobile/src/screens/admin/AdminUsersScreen.tsx) |
| Wholesale Approvals | [`AdminWholesaleScreen.tsx`](mobile/src/screens/admin/AdminWholesaleScreen.tsx) |

### Auth
| Screen | File |
| --- | --- |
| Login | [`LoginScreen.tsx`](mobile/src/screens/auth/LoginScreen.tsx) |
| OTP Verification | [`OtpScreen.tsx`](mobile/src/screens/auth/OtpScreen.tsx) |
| Wholesale Pending | [`WholesalePendingScreen.tsx`](mobile/src/screens/auth/WholesalePendingScreen.tsx) |

---

## 💰 Money Handling

**Every monetary value is an integer number of paise** (₹1 = 100 paise). No floats touch money anywhere. The mobile app converts at the display layer only — [`mobile/src/utils/money.ts`](mobile/src/utils/money.ts).

---

## 🔐 Role Matrix

| Role | Access |
| --- | --- |
| **Retail** | Catalog, cart, checkout, own orders — retail pricing |
| **Wholesale (approved)** | As retail, plus wholesale pricing |
| **Wholesale (pending/rejected)** | Login only — empty permission set, blocked from catalog |
| **Staff** | Products, categories, order status, dashboard — no pricing, no approvals, no accounts |
| **Admin** | Everything, plus pricing, wholesale approvals, staff accounts |

RBAC source of truth: [`backend/src/utils/rbac.ts`](backend/src/utils/rbac.ts)
Client-side mirror (UI gating only): [`mobile/src/store/hooks.ts`](mobile/src/store/hooks.ts)

---

## 🌐 API Surface

Base path: `/api/v1` — All responses follow `{ success, data, meta? }` or `{ success: false, error: { code, message, details? } }`.

| Route | Purpose |
| --- | --- |
| `GET /health` | Liveness + configured integrations |
| `GET /config` | Currency, shipping charges, Razorpay availability |
| `POST /auth/otp/send` · `/verify` · `/refresh` · `/logout` | Session lifecycle |
| `GET/PATCH /auth/me` · `/auth/addresses` · `/auth/devices` | Profile, addresses, FCM tokens |
| `GET/POST/PATCH/DELETE /products` · `/products/categories` · `/products/images` | Catalog + admin CRUD + Cloudinary upload |
| `GET/POST/PATCH/DELETE /cart` · `/wishlist` | Cart and save-for-later |
| `POST /orders/checkout` · `/orders/payment/confirm` · `GET /orders` · `POST /orders/:id/cancel` | Checkout and order tracking |
| `GET /admin/dashboard` · `/admin/orders` · `/admin/wholesale` · `/admin/users` | Admin panel |
| `POST /webhooks/razorpay` | Payment webhook (HMAC-verified, outside JWT pipeline) |

---

## 🚢 Deployment

The backend is configured for **Render** deployment via [`render.yaml`](render.yaml).

```bash
# Build
npm install --include=dev && npm run build

# Start
npm start
```

Set environment variables in the Render dashboard — secrets are marked `sync: false` and never committed.

---

## 📝 Deviations from PRD

1. **Backend built from scratch** — PRD described it as existing, but the repo was empty. Implemented to match §8.2–§8.11. Reconcile with any deployed backend before launch.
2. **Notifications not built** — §4.6 push + in-app notifications removed per client request. Order status visible in order screens instead.
3. **Staff cannot create products** — §8.9 gives staff "product management" but "no pricing changes", while §4.7 makes both prices required. Creation is admin-only; staff retain stock, images, description, category, and visibility.
4. **Addresses embedded on User** — not a separate collection; only read with their owner.
5. **`GET /config` added** — so the app shows shipping charges before order placement.

---

## 🔮 Open Items (PRD §6)

- **COD shipping charge** — `COD_SHIPPING_CHARGE`, currently ₹50
- **Categories / products per category** — paginated and indexed; capacity question, not a rebuild
- **Apple Developer Program** — who owns and pays for it
- **Return/replacement policy** — no in-app screen yet
- **Wholesale document upload** — `gstNumber` and `shopProofUrl` accepted but not required; make required in `auth.validator.ts` if needed
- **Staff vs Admin split** — implemented per §8.9; confirm with client
- **Expo vs bare RN** — built on Expo managed; `npx expo prebuild` ejects if needed

---

## 🚫 Out of Scope (PRD §5)

Multi-vendor · In-app chat · Multi-language · Loyalty/referrals · Web storefront · Returns/refunds automation

---

## 📄 License

Private — all rights reserved.
