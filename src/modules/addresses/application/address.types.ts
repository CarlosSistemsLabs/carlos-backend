/**
 * Address lookup contracts (addresses module).
 *
 * Two steps power the mobile address-validation flow:
 *  1. {@link AddressProvider.autocomplete} — text → candidate {@link AddressSuggestion}s.
 *  2. {@link AddressProvider.locate} — a chosen suggestion id → its geocoded
 *     {@link GeographicAddress} (lat/lon for the map pin).
 */

/** A single autocomplete suggestion. */
export interface AddressSuggestion {
  readonly id: string;
  readonly country: string;
  readonly locality: string;
  readonly stateOrProvince: string;
  readonly streetName: string;
  readonly streetType: string;
}

/** A WGS84 point; `x` is longitude and `y` is latitude (strings, as the provider returns). */
export interface GeographicPoint {
  readonly x: string;
  readonly y: string;
}

/** The geocoded location for a chosen address. */
export interface GeographicLocation {
  readonly geometry: GeographicPoint[];
  readonly geometryType: string;
  readonly name: string;
  readonly spatialRef: string;
}

/** Normalized geographic address with its geocoded [geographicLocation]. */
export interface GeographicAddress {
  readonly '@type': string;
  readonly geographicLocation: GeographicLocation;
  readonly streetName: string;
  readonly streetNr: number | null;
  readonly streetType: string;
  readonly locality: string;
  readonly city: string;
  readonly stateOrProvince: string;
  readonly country: string;
  readonly postcode: string;
  readonly isNormalized: boolean;
}

/** Port implemented by the stub and the Google Places provider. */
export interface AddressProvider {
  autocomplete(query: string): Promise<AddressSuggestion[]>;
  locate(id: string): Promise<GeographicAddress[]>;
}
