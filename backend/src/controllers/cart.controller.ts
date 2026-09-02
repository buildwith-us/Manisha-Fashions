import type { Request, Response } from 'express';
import * as cartService from '../services/cart.service';
import { asyncHandler } from '../utils/asyncHandler';

export const getCart = asyncHandler(async (req: Request, res: Response) => {
  res.success(await cartService.getCart(req.user!));
});

export const addItem = asyncHandler(async (req: Request, res: Response) => {
  res.success(await cartService.addToCart(req.user!, req.body.productId, req.body.quantity));
});

export const updateItem = asyncHandler(async (req: Request, res: Response) => {
  res.success(
    await cartService.updateCartItem(req.user!, req.params.productId, req.body.quantity),
  );
});

export const removeItem = asyncHandler(async (req: Request, res: Response) => {
  res.success(await cartService.removeFromCart(req.user!, req.params.productId));
});

export const clear = asyncHandler(async (req: Request, res: Response) => {
  await cartService.clearCart(req.user!.id);
  res.success({ message: 'Cart cleared.' });
});

export const getWishlist = asyncHandler(async (req: Request, res: Response) => {
  res.success(await cartService.getWishlist(req.user!));
});

export const toggleWishlist = asyncHandler(async (req: Request, res: Response) => {
  res.success(await cartService.toggleWishlist(req.user!, req.params.productId));
});
