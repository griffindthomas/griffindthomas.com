import type { Family, Planform, TipDevice } from '../lib/planform';
import data from './aircraft-types.json';

/**
 * The type board's catalogue, kept by family rather than by variant.
 *
 * A board with 737-8 and 737-9 on it as separate squares is a board that
 * cannot be finished and does not say much: from the fence they are the same
 * aeroplane with a different number of windows. Families are the unit a
 * spotter collects in, so a 737 MAX is one plate however many sub-variants
 * exist, and the drawing is of the variant named in `drawn`.
 *
 * The records live in `aircraft-types.json` rather than in this file, for the
 * same reason the airports do: the studio editor is plain Node with no
 * TypeScript, and it has to offer exactly the codes the site counts. A second
 * copy of this list is a typo waiting to happen, and the typo would be silent
 * because a photo with an unknown code still shows in the gallery and simply
 * never reaches the board.
 *
 * `codes` are the ICAO type codes that count as that family, and they have to
 * agree with the `typeCode` field in the photo sidecars. A photo whose code is
 * in this list moves its family from the wanted grid to the caught one, with
 * nothing to edit here.
 *
 * Span and length are published figures for the drawn variant, in feet. They
 * set the size of the drawing, and every type on the board is drawn to one
 * scale, so a 747 really is the size of four F-35s.
 */
export interface AircraftFamily {
  id: string;
  /** ICAO type codes that belong to this family. */
  codes: string[];
  /** Family name on the plate. */
  name: string;
  /** The variant the drawing and the dimensions are of. */
  drawn: string;
  /** Wingspan, feet. */
  span: number;
  /** Overall length, feet. */
  length: number;
  shape: Planform;
}

const FAMILIES: Family[] = ['jet', 'fighter'];
const TIPS: TipDevice[] = ['plain', 'raked'];

/**
 * Checked on the way in, because the catalogue is now plain JSON and nothing
 * else would catch a bad value. A misspelled `family` would otherwise draw an
 * airliner where a fighter belongs, which is the kind of wrong that looks
 * deliberate. Throwing here fails the build instead.
 */
function validate(entries: unknown): AircraftFamily[] {
  const list = entries as AircraftFamily[];
  const seen = new Map<string, string>();

  for (const entry of list) {
    if (!FAMILIES.includes(entry.shape.family)) {
      throw new Error(`${entry.id}: shape.family must be one of ${FAMILIES.join(', ')}`);
    }
    if (!TIPS.includes(entry.shape.tip)) {
      throw new Error(`${entry.id}: shape.tip must be one of ${TIPS.join(', ')}`);
    }
    if (!(entry.span > 0) || !(entry.length > 0)) {
      throw new Error(`${entry.id}: span and length are what size the drawing`);
    }
    for (const code of entry.codes) {
      const owner = seen.get(code);
      // One code cannot belong to two families, or a photo would count twice.
      if (owner) throw new Error(`type code ${code} is in both ${owner} and ${entry.id}`);
      seen.set(code, entry.id);
    }
  }

  return list;
}

export const AIRCRAFT_TYPES: AircraftFamily[] = validate(data);

/**
 * Every drawing is scaled against the largest aeroplane on the board, so the
 * sizes can be compared instead of each one filling its own box.
 */
export const SCALE_REFERENCE = Math.max(
  ...AIRCRAFT_TYPES.map((t) => Math.max(t.span, t.length)),
);

const BY_CODE = new Map<string, AircraftFamily>();
for (const family of AIRCRAFT_TYPES) {
  for (const code of family.codes) BY_CODE.set(code, family);
}

export const familyForCode = (code: string): AircraftFamily | null => BY_CODE.get(code) ?? null;
