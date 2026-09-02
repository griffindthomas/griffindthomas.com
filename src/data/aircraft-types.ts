import type { Planform } from '../lib/planform';

/**
 * The type board's catalogue.
 *
 * Two jobs. Anything here that matches a photo in the library is drawn inked
 * in, and anything that does not is drawn as an outline in the "yet to
 * photograph" grid, which makes the wanted list the same file as the caught
 * list. Adding a target is a row here; catching it moves the row on its own
 * once the photo is imported.
 *
 * `code` is the ICAO type code and is what matches a photo, so it has to
 * agree with the `typeCode` field in the photo sidecars. Span and length are
 * published figures in feet, rounded to a tenth, and they set the proportions
 * of the drawing rather than just captioning it.
 *
 * The shape fields are described in src/lib/planform.ts.
 */
export interface AircraftType {
  code: string;
  /** Display name on the plate. */
  name: string;
  /** Wingspan, feet. */
  span: number;
  /** Overall length, feet. */
  length: number;
  shape: Planform;
}

const AIRLINER: Pick<Planform, 'family' | 'engines' | 'fins'> = {
  family: 'jet',
  engines: 2,
  fins: 1,
};

export const AIRCRAFT_TYPES: AircraftType[] = [
  // --- in the library ------------------------------------------------------
  {
    code: 'B38M',
    name: '737-8 MAX',
    span: 117.8,
    length: 129.7,
    shape: { ...AIRLINER, sweep: 25.5, wingAt: 0.42, rootChord: 0.2, taper: 0.28, waist: 0.095, tip: 'winglet' },
  },
  {
    code: 'B789',
    name: '787-9',
    span: 197.2,
    length: 206.1,
    shape: { ...AIRLINER, sweep: 32, wingAt: 0.4, rootChord: 0.21, taper: 0.22, waist: 0.093, tip: 'raked' },
  },
  {
    code: 'P8',
    name: 'P-8A Poseidon',
    span: 123.5,
    length: 129.5,
    shape: { ...AIRLINER, sweep: 25.5, wingAt: 0.44, rootChord: 0.2, taper: 0.26, waist: 0.095, tip: 'raked' },
  },
  {
    code: 'F18',
    name: 'F/A-18E',
    span: 44.7,
    length: 60.1,
    shape: {
      family: 'fighter',
      engines: 0,
      fins: 2,
      strake: true,
      sweep: 27,
      wingAt: 0.5,
      rootChord: 0.26,
      taper: 0.3,
      waist: 0.155,
      tip: 'plain',
    },
  },

  // --- wanted --------------------------------------------------------------
  {
    code: 'BCS3',
    name: 'A220-300',
    span: 115.2,
    length: 127,
    shape: { ...AIRLINER, sweep: 27, wingAt: 0.42, rootChord: 0.19, taper: 0.26, waist: 0.09, tip: 'winglet' },
  },
  {
    code: 'A21N',
    name: 'A321neo',
    span: 117.5,
    length: 146,
    shape: { ...AIRLINER, sweep: 25, wingAt: 0.4, rootChord: 0.18, taper: 0.26, waist: 0.085, tip: 'winglet' },
  },
  {
    code: 'A339',
    name: 'A330-900',
    span: 210,
    length: 208.9,
    shape: { ...AIRLINER, sweep: 30, wingAt: 0.38, rootChord: 0.2, taper: 0.24, waist: 0.09, tip: 'winglet' },
  },
  {
    code: 'A359',
    name: 'A350-900',
    span: 212.4,
    length: 219.2,
    shape: { ...AIRLINER, sweep: 31.9, wingAt: 0.39, rootChord: 0.2, taper: 0.22, waist: 0.088, tip: 'raked' },
  },
  {
    code: 'B739',
    name: '737-900ER',
    span: 117.4,
    length: 138.2,
    shape: { ...AIRLINER, sweep: 25.5, wingAt: 0.42, rootChord: 0.19, taper: 0.28, waist: 0.09, tip: 'winglet' },
  },
  {
    code: 'B752',
    name: '757-200',
    span: 124.8,
    length: 155.3,
    shape: { ...AIRLINER, sweep: 25, wingAt: 0.4, rootChord: 0.17, taper: 0.26, waist: 0.08, tip: 'winglet' },
  },
  {
    code: 'B763',
    name: '767-300F',
    span: 156.1,
    length: 180.2,
    shape: { ...AIRLINER, sweep: 31.5, wingAt: 0.39, rootChord: 0.19, taper: 0.25, waist: 0.088, tip: 'plain' },
  },
  {
    code: 'B77W',
    name: '777-300ER',
    span: 212.6,
    length: 242.3,
    shape: { ...AIRLINER, sweep: 31.6, wingAt: 0.38, rootChord: 0.2, taper: 0.22, waist: 0.087, tip: 'raked' },
  },
  {
    code: 'B779',
    name: '777-9',
    span: 235.4,
    length: 251.7,
    shape: { ...AIRLINER, sweep: 32.5, wingAt: 0.38, rootChord: 0.2, taper: 0.21, waist: 0.086, tip: 'raked' },
  },
  {
    code: 'B748',
    name: '747-8F',
    span: 224.4,
    length: 250.3,
    shape: {
      family: 'jet',
      fins: 1,
      engines: 4,
      sweep: 37.5,
      wingAt: 0.36,
      rootChord: 0.22,
      taper: 0.2,
      waist: 0.085,
      tip: 'raked',
    },
  },
  {
    code: 'E75L',
    name: 'E175',
    span: 94,
    length: 103.9,
    shape: { ...AIRLINER, sweep: 24, wingAt: 0.42, rootChord: 0.18, taper: 0.28, waist: 0.1, tip: 'winglet' },
  },
  {
    code: 'C17',
    name: 'C-17 Globemaster III',
    span: 169.8,
    length: 174,
    shape: {
      family: 'jet',
      fins: 1,
      engines: 4,
      highWing: true,
      sweep: 25,
      wingAt: 0.33,
      rootChord: 0.21,
      taper: 0.3,
      waist: 0.13,
      tip: 'winglet',
    },
  },
  {
    code: 'K35R',
    name: 'KC-135R',
    span: 130.8,
    length: 136.3,
    shape: {
      family: 'jet',
      fins: 1,
      engines: 4,
      sweep: 35,
      wingAt: 0.4,
      rootChord: 0.2,
      taper: 0.25,
      waist: 0.098,
      tip: 'plain',
    },
  },
  {
    code: 'F22',
    name: 'F-22 Raptor',
    span: 44.5,
    length: 62.1,
    shape: {
      family: 'fighter',
      engines: 0,
      fins: 2,
      strake: true,
      sweep: 42,
      wingAt: 0.44,
      rootChord: 0.34,
      taper: 0.14,
      waist: 0.165,
      tip: 'plain',
    },
  },
];

export const typeByCode = (code: string): AircraftType | null =>
  AIRCRAFT_TYPES.find((t) => t.code === code) ?? null;
