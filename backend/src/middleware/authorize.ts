import type { NextFunction, Request, Response } from 'express';
import { ApiError } from '../utils/ApiError';
import type { AccountType } from '../types';
import type { Permission } from '../utils/rbac';

/**
 * PRD 8.8 — Role & Permission Check stage.
 *
 * Runs only after authentication. An authenticated-but-unauthorised request
 * returns 403 Forbidden, never 401 — the mobile client relies on that split to
 * decide between "refresh the token" and "show access denied" (PRD 8.10).
 */
export function requirePermission(...permissions: Permission[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(ApiError.unauthorized('Authentication required', 'NO_TOKEN'));
      return;
    }

    const granted = permissions.every((permission) => req.user!.permissions.includes(permission));
    if (!granted) {
      // A pending or rejected wholesale applicant has an empty permission set
      // (PRD 4.1), so give them a message that explains why rather than a bare 403.
      if (req.user.accountType === 'wholesale' && req.user.wholesaleStatus !== 'approved') {
        next(
          new ApiError(
            403,
            req.user.wholesaleStatus === 'rejected'
              ? 'Your wholesale application was not approved. Please contact support or re-apply.'
              : 'Your wholesale account is awaiting admin approval.',
            'WHOLESALE_NOT_APPROVED',
          ),
        );
        return;
      }
      next(ApiError.forbidden());
      return;
    }

    next();
  };
}

/**
 * Public-read guard for guest-first browsing.
 *
 * A request with no token passes straight through — the serializer treats an
 * absent viewer as retail and strips wholesalePrice, so a guest can only ever
 * see retail figures.
 *
 * A request that DOES carry a token is held to the full permission check. That
 * is what keeps PRD 4.1 intact: a pending or rejected wholesale applicant has
 * an empty permission set, so they are still refused with the same explanatory
 * 403 as before. Guest browsing does not become a way around approval.
 */
export function allowGuestOrPermission(...permissions: Permission[]) {
  const guarded = requirePermission(...permissions);
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      next();
      return;
    }
    guarded(req, res, next);
  };
}

export function requireRole(...roles: AccountType[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(ApiError.unauthorized('Authentication required', 'NO_TOKEN'));
      return;
    }
    if (!roles.includes(req.user.accountType)) {
      next(ApiError.forbidden());
      return;
    }
    next();
  };
}
