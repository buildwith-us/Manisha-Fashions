import type { Request, Response } from 'express';
import * as reviewService from '../services/review.service';
import { asyncHandler } from '../utils/asyncHandler';

export const list = asyncHandler(async (req: Request, res: Response) => {
  const { page, limit } = req.query as unknown as { page: number; limit: number };
  const result = await reviewService.listForProduct(req.params.id, page, limit, req.user?.id);
  res.success({ items: result.items, summary: result.summary }, result.pagination);
});

export const upsert = asyncHandler(async (req: Request, res: Response) => {
  const review = await reviewService.upsertReview(req.params.id, req.user!.id, req.body);
  res.success(review, undefined, 201);
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  await reviewService.deleteReview(req.params.id, req.user!.id);
  res.success({ message: 'Review removed.' });
});
