import type { IUser } from '../models/user.model';
import { resolvePermissions } from '../utils/rbac';

export interface SerializedUser {
  id: string;
  phone: string;
  name?: string;
  email?: string;
  accountType: IUser['accountType'];
  wholesaleStatus: IUser['wholesaleStatus'];
  business?: {
    businessName?: string;
    gstNumber?: string;
    shopProofUrl?: string;
    appliedAt?: string;
  };
  wholesaleRejectionReason?: string;
  permissions: string[];
  addresses: SerializedAddress[];
  /**
   * Deactivated accounts are refused at login, on refresh and on every
   * authenticated request, so this is always true for the account reading its
   * own profile. It is here for the admin accounts list, which is the only
   * caller that can see somebody else's.
   */
  isActive: boolean;
  createdAt: string;
}

export interface SerializedAddress {
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

export function serializeAddress(address: IUser['addresses'][number]): SerializedAddress {
  return {
    id: address._id.toString(),
    label: address.label,
    fullName: address.fullName,
    phone: address.phone,
    line1: address.line1,
    line2: address.line2,
    city: address.city,
    state: address.state,
    pincode: address.pincode,
    isDefault: address.isDefault,
  };
}

export function serializeUser(user: IUser): SerializedUser {
  return {
    id: user._id.toString(),
    phone: user.phone,
    name: user.name,
    email: user.email,
    accountType: user.accountType,
    wholesaleStatus: user.wholesaleStatus,
    ...(user.business
      ? {
          business: {
            businessName: user.business.businessName,
            gstNumber: user.business.gstNumber,
            shopProofUrl: user.business.shopProofUrl,
            appliedAt: user.business.appliedAt?.toISOString(),
          },
        }
      : {}),
    // Rejected applicants get a clear status message (PRD 4.1).
    ...(user.wholesaleStatus === 'rejected' && user.wholesaleReview?.reason
      ? { wholesaleRejectionReason: user.wholesaleReview.reason }
      : {}),
    permissions: resolvePermissions(user.accountType, user.wholesaleStatus),
    addresses: (user.addresses ?? []).map(serializeAddress),
    isActive: user.isActive,
    createdAt: user.createdAt.toISOString(),
  };
}
