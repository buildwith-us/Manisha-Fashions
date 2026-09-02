import { createAsyncThunk, createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { productApi, wishlistApi } from '../../api/endpoints';
import { ApiError } from '../../api/client';
import type { Category, Pagination, Product, ProductFilters } from '../../api/types';

/**
 * PRD 8.1 productSlice — product list, selected category, active filters/sort
 * and the search query. Pagination state lives here so the catalogue's infinite
 * scroll (PRD 4.2) can append pages without refetching what it already has.
 */

interface ProductState {
  items: Product[];
  pagination: Pagination | null;
  categories: Category[];
  filters: ProductFilters;
  wishlistIds: string[];
  loading: boolean;
  loadingMore: boolean;
  refreshing: boolean;
  error: string | null;
  /** Set when the API refuses browsing because wholesale approval is pending. */
  accessBlocked: string | null;
}

const defaultFilters: ProductFilters = { sort: 'newest' };

const initialState: ProductState = {
  items: [],
  pagination: null,
  categories: [],
  filters: defaultFilters,
  wishlistIds: [],
  loading: false,
  loadingMore: false,
  refreshing: false,
  error: null,
  accessBlocked: null,
};

export const fetchProducts = createAsyncThunk<
  { items: Product[]; pagination?: Pagination; page: number },
  { page?: number; refresh?: boolean } | undefined,
  { state: { product: ProductState }; rejectValue: { message: string; blocked?: boolean } }
>('product/fetch', async (args, { getState, rejectWithValue }) => {
  const page = args?.page ?? 1;
  const { filters } = getState().product;

  try {
    const { data, pagination } = await productApi.list({ ...filters, page, limit: 20 });
    return { items: data, pagination, page };
  } catch (error) {
    if (error instanceof ApiError && error.isWholesalePending) {
      return rejectWithValue({ message: error.message, blocked: true });
    }
    return rejectWithValue({
      message: error instanceof ApiError ? error.message : 'Could not load products.',
    });
  }
});

export const fetchCategories = createAsyncThunk<Category[]>('product/fetchCategories', async () =>
  productApi.categories(),
);

export const fetchWishlist = createAsyncThunk<Product[]>('product/fetchWishlist', async () =>
  wishlistApi.list(),
);

export const toggleWishlist = createAsyncThunk<
  { wishlisted: boolean; items: Product[] },
  string
>('product/toggleWishlist', async (productId) => wishlistApi.toggle(productId));

const productSlice = createSlice({
  name: 'product',
  initialState,
  reducers: {
    setFilters(state, action: PayloadAction<Partial<ProductFilters>>) {
      state.filters = { ...state.filters, ...action.payload };
    },
    resetFilters(state) {
      state.filters = { ...defaultFilters, search: state.filters.search };
    },
    setSearch(state, action: PayloadAction<string | undefined>) {
      state.filters.search = action.payload?.trim() ? action.payload.trim() : undefined;
    },
    clearCatalog(state) {
      state.items = [];
      state.pagination = null;
      state.accessBlocked = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchProducts.pending, (state, action) => {
        const page = action.meta.arg?.page ?? 1;
        if (action.meta.arg?.refresh) state.refreshing = true;
        else if (page > 1) state.loadingMore = true;
        else state.loading = true;
        state.error = null;
      })
      .addCase(fetchProducts.fulfilled, (state, action) => {
        state.loading = false;
        state.loadingMore = false;
        state.refreshing = false;
        state.accessBlocked = null;
        // Page 1 replaces; later pages append for infinite scroll.
        state.items =
          action.payload.page === 1
            ? action.payload.items
            : [...state.items, ...action.payload.items];
        state.pagination = action.payload.pagination ?? null;
      })
      .addCase(fetchProducts.rejected, (state, action) => {
        state.loading = false;
        state.loadingMore = false;
        state.refreshing = false;
        if (action.payload?.blocked) {
          state.accessBlocked = action.payload.message;
          state.items = [];
        } else {
          state.error = action.payload?.message ?? 'Could not load products.';
        }
      })

      .addCase(fetchCategories.fulfilled, (state, action) => {
        state.categories = action.payload;
      })

      .addCase(fetchWishlist.fulfilled, (state, action) => {
        state.wishlistIds = action.payload.map((product) => product.id);
      })
      .addCase(toggleWishlist.fulfilled, (state, action) => {
        state.wishlistIds = action.payload.items.map((product) => product.id);
      });
  },
});

export const { setFilters, resetFilters, setSearch, clearCatalog } = productSlice.actions;
export default productSlice.reducer;
