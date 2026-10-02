import type { Environment } from '@config/environment';
import type { AddressProvider } from '../application/address.types.js';
import { GooglePlacesAddressProvider } from './google-places-address-provider.js';
import { StubAddressProvider } from './stub-address-provider.js';

/**
 * Picks the address provider from configuration: the real Google Places provider
 * when `GOOGLE_PLACES_API_KEY` is set, otherwise the deterministic stub so the
 * endpoints work in every environment without a key.
 */
export function buildAddressProvider(env: Environment): AddressProvider {
  const key = env.GOOGLE_PLACES_API_KEY;
  if (key !== undefined && key.trim() !== '') {
    return new GooglePlacesAddressProvider(key);
  }
  return new StubAddressProvider();
}
