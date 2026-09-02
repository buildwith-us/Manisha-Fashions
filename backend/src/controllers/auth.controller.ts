import type { Request, Response } from 'express';
import * as authService from '../services/auth.service';
import * as addressService from '../services/address.service';
import { asyncHandler } from '../utils/asyncHandler';

function loginContext(req: Request) {
  return {
    deviceId: typeof req.body?.deviceId === 'string' ? req.body.deviceId : undefined,
    userAgent: req.headers['user-agent'],
  };
}

export const sendOtp = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.requestOtp(req.body.phone);
  res.success({
    message: 'A verification code has been sent to your mobile number.',
    ...result,
  });
});

export const verifyOtp = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.verifyOtpAndLogin({
    phone: req.body.phone,
    code: req.body.code,
    accountType: req.body.accountType,
    application: req.body.application,
    context: loginContext(req),
  });
  res.success(result);
});

export const refresh = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.refreshSession(req.body.refreshToken, loginContext(req));
  res.success(result);
});

export const logout = asyncHandler(async (req: Request, res: Response) => {
  await authService.logout(req.body.refreshToken);
  res.success({ message: 'Signed out.' });
});

export const me = asyncHandler(async (req: Request, res: Response) => {
  res.success(await authService.getProfile(req.user!.id));
});

export const updateProfile = asyncHandler(async (req: Request, res: Response) => {
  res.success(await authService.updateProfile(req.user!.id, req.body));
});

export const applyForWholesale = asyncHandler(async (req: Request, res: Response) => {
  res.success(await authService.applyForWholesale(req.user!.id, req.body));
});

/* ── Addresses ──────────────────────────────────────────────────────────── */

export const listAddresses = asyncHandler(async (req: Request, res: Response) => {
  res.success(await addressService.listAddresses(req.user!.id));
});

export const addAddress = asyncHandler(async (req: Request, res: Response) => {
  res.success(await addressService.addAddress(req.user!.id, req.body), undefined, 201);
});

export const updateAddress = asyncHandler(async (req: Request, res: Response) => {
  res.success(await addressService.updateAddress(req.user!.id, req.params.id, req.body));
});

export const deleteAddress = asyncHandler(async (req: Request, res: Response) => {
  res.success(await addressService.deleteAddress(req.user!.id, req.params.id));
});

