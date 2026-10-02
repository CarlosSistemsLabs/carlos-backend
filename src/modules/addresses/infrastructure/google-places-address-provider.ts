import type {
  AddressProvider,
  AddressSuggestion,
  GeographicAddress,
} from '../application/address.types.js';

/** Minimal shapes of the Places API (New) responses we consume. */
interface NewAutocompleteResponse {
  readonly suggestions?: ReadonlyArray<{
    readonly placePrediction?: {
      readonly placeId?: string;
      readonly text?: { readonly text?: string };
      readonly structuredFormat?: {
        readonly mainText?: { readonly text?: string };
        readonly secondaryText?: { readonly text?: string };
      };
    };
  }>;
}

interface NewAddressComponent {
  readonly longText?: string;
  readonly shortText?: string;
  readonly types?: readonly string[];
}

interface NewDetailsResponse {
  readonly location?: { readonly latitude?: number; readonly longitude?: number };
  readonly addressComponents?: readonly NewAddressComponent[];
}

const AUTOCOMPLETE_URL = 'https://places.googleapis.com/v1/places:autocomplete';
const DETAILS_URL = 'https://places.googleapis.com/v1/places';

/**
 * {@link AddressProvider} backed by the **Places API (New)** (Autocomplete +
 * Place Details). Used when `GOOGLE_PLACES_API_KEY` is configured.
 *
 * The key MUST allow server-side use (no Android-app restriction — those calls
 * are blocked with `API_KEY_ANDROID_APP_BLOCKED`). Results are restricted to
 * Argentina (`includedRegionCodes: ["ar"]`) and Spanish. On any non-2xx
 * response the error is logged and an empty result is returned so the mobile
 * client always receives a well-formed (if empty) payload.
 */
export class GooglePlacesAddressProvider implements AddressProvider {
  constructor(private readonly apiKey: string) {}

  async autocomplete(query: string): Promise<AddressSuggestion[]> {
    const response = await fetch(AUTOCOMPLETE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': this.apiKey,
      },
      body: JSON.stringify({
        input: query,
        languageCode: 'es',
        includedRegionCodes: ['ar'],
      }),
    });

    if (!response.ok) {
      await logFailure('autocomplete', response);
      return [];
    }

    const data = (await response.json()) as NewAutocompleteResponse;
    return (data.suggestions ?? []).flatMap((suggestion) => {
      const prediction = suggestion.placePrediction;
      const id = prediction?.placeId;
      if (prediction === undefined || id === undefined) return [];

      const main = prediction.structuredFormat?.mainText?.text ?? prediction.text?.text ?? '';
      const secondary = prediction.structuredFormat?.secondaryText?.text ?? '';
      const parts = secondary
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part.length > 0);

      return [
        {
          id,
          country: parts.at(-1) ?? 'Argentina',
          locality: parts.at(-3) ?? parts.at(0) ?? '',
          stateOrProvince: parts.at(-2) ?? '',
          streetName: main,
          streetType: 'street',
        },
      ];
    });
  }

  async locate(id: string): Promise<GeographicAddress[]> {
    const url = `${DETAILS_URL}/${encodeURIComponent(id)}`;
    const response = await fetch(url, {
      headers: {
        'X-Goog-Api-Key': this.apiKey,
        'X-Goog-FieldMask': 'location,addressComponents',
      },
    });

    if (!response.ok) {
      await logFailure('details', response);
      return [];
    }

    const data = (await response.json()) as NewDetailsResponse;
    const lat = data.location?.latitude;
    const lng = data.location?.longitude;
    if (lat === undefined || lng === undefined) return [];

    const components = data.addressComponents ?? [];
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
      locality:
        component(components, 'locality') ||
        component(components, 'administrative_area_level_2'),
      city: component(components, 'locality'),
      stateOrProvince: component(components, 'administrative_area_level_1'),
      country: component(components, 'country'),
      postcode: component(components, 'postal_code'),
      isNormalized: true,
    };
    return [address];
  }
}

/** Returns the `longText` of the first component whose types include [type], or ''. */
function component(components: readonly NewAddressComponent[], type: string): string {
  return components.find((c) => (c.types ?? []).includes(type))?.longText ?? '';
}

/** Logs a non-2xx Places response (status + a short body excerpt) for diagnostics. */
async function logFailure(operation: string, response: Response): Promise<void> {
  let body = '';
  try {
    body = (await response.text()).slice(0, 300);
  } catch {
    body = '<unreadable body>';
  }
  // eslint-disable-next-line no-console
  console.warn(`[addresses] Places ${operation} failed: ${response.status} ${body}`);
}
