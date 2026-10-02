import type {
  AddressProvider,
  AddressSuggestion,
  GeographicAddress,
} from '../application/address.types.js';

interface StubLocality {
  readonly id: string;
  readonly locality: string;
  readonly stateOrProvince: string;
  readonly lat: number;
  readonly lon: number;
  readonly postcode: string;
}

/**
 * A fixed set of real Argentine localities with coordinates, used to synthesize
 * suggestions/locations without an external provider.
 */
const STUB_LOCALITIES: readonly StubLocality[] = [
  {
    id: 'stub-neuquen',
    locality: 'Neuquén',
    stateOrProvince: 'Neuquén',
    lat: -38.9516,
    lon: -68.0591,
    postcode: '8300',
  },
  {
    id: 'stub-caba',
    locality: 'Ciudad Autónoma de Buenos Aires',
    stateOrProvince: 'Ciudad Autónoma de Buenos Aires',
    lat: -34.6037,
    lon: -58.3816,
    postcode: '1000',
  },
  {
    id: 'stub-carlospaz',
    locality: 'Villa Carlos Paz',
    stateOrProvince: 'Córdoba',
    lat: -31.4207,
    lon: -64.4886,
    postcode: '5152',
  },
  {
    id: 'stub-santiago',
    locality: 'Santiago del Estero',
    stateOrProvince: 'Santiago del Estero',
    lat: -27.7951,
    lon: -64.2615,
    postcode: '4200',
  },
  {
    id: 'stub-campana',
    locality: 'Campana',
    stateOrProvince: 'Provincia de Buenos Aires',
    lat: -34.1636,
    lon: -58.9592,
    postcode: '2804',
  },
];

function titleCase(value: string): string {
  return value
    .trim()
    .split(/\s+/)
    .map((word) => (word.length > 0 ? word[0]!.toUpperCase() + word.slice(1).toLowerCase() : word))
    .join(' ');
}

/**
 * Deterministic {@link AddressProvider} used when no Google Places key is set.
 *
 * [autocomplete] echoes the typed street across the fixed localities so the
 * mobile dropdown shows plausible options; [locate] returns the locality's real
 * coordinates so the map pin lands on a real place. Swap in the real provider
 * by configuring `GOOGLE_PLACES_API_KEY`.
 */
export class StubAddressProvider implements AddressProvider {
  autocomplete(query: string): Promise<AddressSuggestion[]> {
    const streetName = titleCase(query);
    const suggestions = STUB_LOCALITIES.map<AddressSuggestion>((loc) => ({
      id: loc.id,
      country: 'Argentina',
      locality: loc.locality,
      stateOrProvince: loc.stateOrProvince,
      streetName,
      streetType: 'street',
    }));
    return Promise.resolve(suggestions);
  }

  locate(id: string): Promise<GeographicAddress[]> {
    const loc = STUB_LOCALITIES.find((l) => l.id === id) ?? STUB_LOCALITIES[0]!;
    const address: GeographicAddress = {
      '@type': 'TelecomGeographicAddress',
      geographicLocation: {
        geometry: [{ x: String(loc.lon), y: String(loc.lat) }],
        geometryType: 'POINT',
        name: 'Stub geocoder',
        spatialRef: 'WGS84',
      },
      streetName: loc.locality,
      streetNr: null,
      streetType: 'CALLE',
      locality: loc.locality,
      city: loc.locality,
      stateOrProvince: loc.stateOrProvince,
      country: 'ARGENTINA',
      postcode: loc.postcode,
      isNormalized: true,
    };
    return Promise.resolve([address]);
  }
}
