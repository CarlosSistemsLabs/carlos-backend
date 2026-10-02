import type {
  AddressProvider,
  AddressSuggestion,
  GeographicAddress,
} from '../application/address.types.js';

/** Minimal shapes of the Google Places responses we consume. */
interface GoogleAutocompleteResponse {
  readonly predictions?: ReadonlyArray<{
    readonly place_id?: string;
    readonly description?: string;
    readonly structured_formatting?: { readonly main_text?: string };
    readonly terms?: ReadonlyArray<{ readonly value?: string }>;
  }>;
}

interface GoogleComponent {
  readonly long_name?: string;
  readonly types?: readonly string[];
}

interface GoogleDetailsResponse {
  readonly result?: {
    readonly geometry?: { readonly location?: { readonly lat?: number; readonly lng?: number } };
    readonly address_components?: readonly GoogleComponent[];
  };
}

const AUTOCOMPLETE_URL = 'https://maps.googleapis.com/maps/api/place/autocomplete/json';
const DETAILS_URL = 'https://maps.googleapis.com/maps/api/place/details/json';

/**
 * {@link AddressProvider} backed by Google Places (Autocomplete + Details).
 *
 * Used when `GOOGLE_PLACES_API_KEY` is configured. Best-effort mapping from
 * Google's structures to the module contract; results are restricted to
 * Argentina and Spanish locale. Throwing/here-undefined fields degrade to empty
 * strings so the mobile client always receives well-formed objects.
 */
export class GooglePlacesAddressProvider implements AddressProvider {
  constructor(private readonly apiKey: string) {}

  async autocomplete(query: string): Promise<AddressSuggestion[]> {
    const url = `${AUTOCOMPLETE_URL}?input=${encodeURIComponent(query)}` +
      `&language=es&components=country:ar&key=${encodeURIComponent(this.apiKey)}`;
    const response = await fetch(url);
    const data = (await response.json()) as GoogleAutocompleteResponse;
    return (data.predictions ?? []).flatMap((prediction) => {
      const id = prediction.place_id;
      if (id === undefined) return [];
      const terms = prediction.terms ?? [];
      const streetName = prediction.structured_formatting?.main_text ?? terms[0]?.value ?? '';
      return [
        {
          id,
          country: terms.at(-1)?.value ?? 'Argentina',
          locality: terms.at(-3)?.value ?? '',
          stateOrProvince: terms.at(-2)?.value ?? '',
          streetName,
          streetType: 'street',
        },
      ];
    });
  }

  async locate(id: string): Promise<GeographicAddress[]> {
    const url = `${DETAILS_URL}?place_id=${encodeURIComponent(id)}` +
      `&language=es&fields=geometry,address_component&key=${encodeURIComponent(this.apiKey)}`;
    const response = await fetch(url);
    const data = (await response.json()) as GoogleDetailsResponse;
    const result = data.result;
    if (result?.geometry?.location === undefined) return [];

    const lat = result.geometry.location.lat ?? 0;
    const lng = result.geometry.location.lng ?? 0;
    const components = result.address_components ?? [];
    const streetNrText = component(components, 'street_number');

    const address: GeographicAddress = {
      '@type': 'TelecomGeographicAddress',
      geographicLocation: {
        geometry: [{ x: String(lng), y: String(lat) }],
        geometryType: 'POINT',
        name: 'Google Maps',
        spatialRef: 'WGS84',
      },
      streetName: component(components, 'route'),
      streetNr: streetNrText === '' ? null : Number.parseInt(streetNrText, 10),
      streetType: 'CALLE',
      locality: component(components, 'locality') || component(components, 'administrative_area_level_2'),
      city: component(components, 'locality'),
      stateOrProvince: component(components, 'administrative_area_level_1'),
      country: component(components, 'country'),
      postcode: component(components, 'postal_code'),
      isNormalized: true,
    };
    return [address];
  }
}

/** Returns the `long_name` of the first component whose types include [type], or ''. */
function component(components: readonly GoogleComponent[], type: string): string {
  return components.find((c) => (c.types ?? []).includes(type))?.long_name ?? '';
}
