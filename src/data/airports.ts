/**
 * Airports referenced by the photo library.
 *
 * The records live in `airports.json` rather than in this file so that the
 * studio editor (plain Node, no TypeScript) and the site can read exactly the
 * same list. A dropdown built from a second copy of this data is a typo
 * waiting to happen.
 *
 * Keyed by ICAO because that is what the photo sidecars store and what ADS-B
 * data uses. IATA rides along purely for display, since most readers recognise
 * SEA faster than KSEA.
 *
 * Add an entry to the JSON before using its code on a photo: the content
 * schema validates against this list, so a typo fails the build instead of
 * quietly producing a gallery filter with one photo behind it.
 */
import data from "./airports.json";

export interface Airport {
  icao: string;
  iata: string;
  name: string;
  city: string;
  lat: number;
  lon: number;
}

export const AIRPORTS: Record<string, Airport> = data;

export const AIRPORT_CODES = Object.keys(AIRPORTS);

export const airport = (icao: string | null | undefined): Airport | null =>
  icao ? (AIRPORTS[icao] ?? null) : null;
