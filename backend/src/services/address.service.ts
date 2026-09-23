import { canonicalStateName } from '../constants/indianStates';
import { User } from '../models/user.model';
import { serializeAddress, type SerializedAddress } from '../serializers/user.serializer';
import { ApiError } from '../utils/ApiError';

/** PRD 4.3 — multiple saved delivery addresses per customer. */
export interface AddressInput {
  label?: string;
  fullName: string;
  phone: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  pincode: string;
  isDefault?: boolean;
}

/**
 * Saves a recognisable state under its catalogue spelling ("Tamilnadu" and
 * "TN" become "Tamil Nadu"), so addresses read consistently and match COD
 * rules without relying on lookup-time folding alone. Anything unrecognised
 * is kept as typed — this corrects spelling, it does not reject addresses.
 */
function withCanonicalState<T extends { state?: string }>(input: T): T {
  if (input.state === undefined) return input;
  return { ...input, state: canonicalStateName(input.state) ?? input.state.trim() };
}

export async function listAddresses(userId: string): Promise<SerializedAddress[]> {
  const user = await User.findById(userId).select('addresses');
  if (!user) throw ApiError.notFound('Account not found');
  return user.addresses.map(serializeAddress);
}

export async function addAddress(
  userId: string,
  input: AddressInput,
): Promise<SerializedAddress[]> {
  const user = await User.findById(userId);
  if (!user) throw ApiError.notFound('Account not found');

  // The first address a customer saves becomes the default automatically.
  const shouldDefault = input.isDefault || user.addresses.length === 0;
  if (shouldDefault) {
    user.addresses.forEach((address) => {
      address.isDefault = false;
    });
  }

  user.addresses.push({ ...withCanonicalState(input), isDefault: shouldDefault } as never);
  await user.save();

  return user.addresses.map(serializeAddress);
}

export async function updateAddress(
  userId: string,
  addressId: string,
  input: Partial<AddressInput>,
): Promise<SerializedAddress[]> {
  const user = await User.findById(userId);
  if (!user) throw ApiError.notFound('Account not found');

  const address = user.addresses.id(addressId);
  if (!address) throw ApiError.notFound('Address not found');

  if (input.isDefault) {
    user.addresses.forEach((entry) => {
      entry.isDefault = false;
    });
  }
  Object.assign(address, withCanonicalState(input));
  await user.save();

  return user.addresses.map(serializeAddress);
}

export async function deleteAddress(
  userId: string,
  addressId: string,
): Promise<SerializedAddress[]> {
  const user = await User.findById(userId);
  if (!user) throw ApiError.notFound('Account not found');

  const address = user.addresses.id(addressId);
  if (!address) throw ApiError.notFound('Address not found');

  const wasDefault = address.isDefault;
  address.deleteOne();

  // Never leave a customer with saved addresses but no default selected.
  if (wasDefault && user.addresses.length > 0) {
    user.addresses[0].isDefault = true;
  }
  await user.save();

  return user.addresses.map(serializeAddress);
}
