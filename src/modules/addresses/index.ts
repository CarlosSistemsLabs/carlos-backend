// Addresses module: address autocomplete + geocoding for the mobile
// address-validation flow.
export type {
  AddressProvider,
  AddressSuggestion,
  GeographicAddress,
  GeographicLocation,
  GeographicPoint,
} from './application/address.types.js';
export { buildAddressProvider } from './infrastructure/address-provider.factory.js';
export { StubAddressProvider } from './infrastructure/stub-address-provider.js';
export { GooglePlacesAddressProvider } from './infrastructure/google-places-address-provider.js';
export { registerAddressRoutes, addressRoutesPlugin } from './presentation/address.routes.js';
