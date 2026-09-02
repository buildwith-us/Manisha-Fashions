import type { Request, Response } from 'express';
import * as productService from '../services/product.service';
import * as uploadService from '../services/upload.service';
import { ApiError } from '../utils/ApiError';
import { asyncHandler } from '../utils/asyncHandler';
import { isStaffRole } from '../utils/rbac';

export const list = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as unknown as {
    page: number;
    limit: number;
    category?: string;
    search?: string;
    minPrice?: number;
    maxPrice?: number;
    sort: 'newest' | 'price_asc' | 'price_desc' | 'name_asc';
    inStockOnly?: boolean;
    includeInactive?: boolean;
  };

  // Only staff may ask to see deactivated products. This route is guest-
  // reachable, so req.user has to be tolerated as absent — a guest asking for
  // includeInactive is simply refused it, not crashed on.
  const includeInactive =
    Boolean(query.includeInactive) && Boolean(req.user) && isStaffRole(req.user!.accountType);

  const result = await productService.listProducts({ ...query, includeInactive }, req.user);
  res.success(result.items, result.pagination);
});

export const detail = asyncHandler(async (req: Request, res: Response) => {
  res.success(await productService.getProduct(req.params.id, req.user));
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  res.success(await productService.createProduct(req.body, req.user!), undefined, 201);
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  res.success(await productService.updateProduct(req.params.id, req.body, req.user!));
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  await productService.deleteProduct(req.params.id);
  res.success({ message: 'Product deleted.' });
});

/* ── Categories ─────────────────────────────────────────────────────────── */

export const listCategories = asyncHandler(async (req: Request, res: Response) => {
  // req.user is absent for a guest, so the staff check has to tolerate it —
  // a guest never sees inactive categories.
  const includeInactive =
    Boolean((req.query as { includeInactive?: boolean }).includeInactive) &&
    Boolean(req.user) &&
    isStaffRole(req.user!.accountType);
  res.success(await productService.listCategories(includeInactive));
});

export const createCategory = asyncHandler(async (req: Request, res: Response) => {
  res.success(await productService.createCategory(req.body), undefined, 201);
});

export const updateCategory = asyncHandler(async (req: Request, res: Response) => {
  res.success(await productService.updateCategory(req.params.id, req.body));
});

export const removeCategory = asyncHandler(async (req: Request, res: Response) => {
  await productService.deleteCategory(req.params.id);
  res.success({ message: 'Category deleted.' });
});

/* ── Image upload (PRD 8.3) ─────────────────────────────────────────────── */

export const uploadImages = asyncHandler(async (req: Request, res: Response) => {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (files.length === 0) throw ApiError.badRequest('Attach at least one image');

  const uploaded = await Promise.all(files.map((file) => uploadService.uploadImage(file)));
  res.success(uploaded, undefined, 201);
});
