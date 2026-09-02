/**
 * Aircraft planforms, drawn from numbers rather than traced by hand.
 *
 * Every silhouette on the type board comes out of this file. Nothing is
 * freehand: each type is described by its real span and length plus a handful
 * of shape parameters, and the geometry falls out of those. A 787 is longer
 * than it is wide and a Super Hornet is not, and both are drawn to their own
 * proportions rather than to a guess at what they look like.
 *
 * Two consequences that matter. Adding a type is a row of data rather than a
 * drawing, so the board grows with the library. And the parts are separate
 * overlapping shapes rather than one traced outline, which is why the ghosted
 * version reads like a technical drawing with its internal lines showing.
 *
 * Top view, nose up, drawn into a 100 by 100 box.
 */

export type Family = 'jet' | 'fighter';
export type TipDevice = 'plain' | 'winglet' | 'raked';

export interface Planform {
  family: Family;
  /** Wing leading edge sweep, degrees from straight across. */
  sweep: number;
  /** Where the wing root leading edge sits, 0 at the nose, 1 at the tail. */
  wingAt: number;
  /** Wing root chord, as a fraction of overall length. */
  rootChord: number;
  /** Tip chord as a fraction of root chord. */
  taper: number;
  /** Fuselage width as a fraction of overall length. */
  waist: number;
  /** Number of engine nacelles drawn under the wing. Fighters carry none. */
  engines: 0 | 2 | 4;
  tip: TipDevice;
  /** Vertical fins. Two means canted outboard, the way a Hornet carries them. */
  fins: 1 | 2;
  /** Leading edge extensions ahead of the wing. Fighters only, and on by
   *  default for them; set false for a type that has none. */
  strake?: boolean;
  /** Wing mounted on top of the fuselage, which sets the nacelles wider. */
  highWing?: boolean;
}

export interface Drawing {
  /** Path data, in draw order. Filled or stroked by the caller. */
  paths: string[];
  viewBox: string;
}

const BOX = 100;
/** Margin, so a wingtip never touches the edge of the plate. */
const FIT = 92;

const rad = (deg: number) => (deg * Math.PI) / 180;
const n = (v: number) => Math.round(v * 100) / 100;

/** A closed polygon through the given points. */
function poly(points: Array<[number, number]>): string {
  return `M ${points.map(([x, y]) => `${n(x)} ${n(y)}`).join(' L ')} Z`;
}

/**
 * A symmetrical shape, described once down the right hand side.
 *
 * Everything on an aeroplane is a mirror image about the centreline, so the
 * shapes are written once and reflected. Doing it any other way is how a
 * silhouette ends up with one wing longer than the other.
 */
function mirrored(cx: number, right: Array<[number, number]>): string {
  const left = [...right].reverse().map(([x, y]): [number, number] => [cx - (x - cx), y]);
  return poly([...right, ...left]);
}

/**
 * Fuselage, sampled as a half width down its length.
 *
 * An ellipse at the nose, parallel through the middle, and a tail cone that
 * closes to a stub rather than to a point, because the tail of an airliner is
 * blunt where the APU exhausts.
 */
function fuselage(cx: number, top: number, len: number, width: number): string {
  const half = width / 2;
  const nose = 0.16;
  const tail = 0.28;
  const right: Array<[number, number]> = [];

  const steps = 30;
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    let w: number;
    if (t < nose) {
      // Elliptical, so the nose is round rather than pointed.
      w = half * Math.sqrt(1 - ((nose - t) / nose) ** 2);
    } else if (t > 1 - tail) {
      const k = (t - (1 - tail)) / tail;
      w = half * (1 - 0.84 * k ** 1.7);
    } else {
      w = half;
    }
    right.push([cx + w, top + t * len]);
  }

  return mirrored(cx, right);
}

/**
 * One wing panel, root to tip.
 *
 * Raked tips are a planform feature and are drawn as one: the outer eighth of
 * the span carries much more sweep, which is what makes a 787 and a P-8
 * recognisable from above. A winglet is vertical and would be invisible in a
 * top view, so it is drawn as the short chordwise tick it casts.
 */
function panel(
  cx: number,
  rootX: number,
  rootY: number,
  semi: number,
  chord: number,
  taper: number,
  sweep: number,
  tip: TipDevice,
): string[] {
  const rakeAt = tip === 'raked' ? 0.86 : 1;
  const inner = semi * rakeAt;
  const tanS = Math.tan(rad(sweep));

  const kinkX = rootX + inner;
  const kinkY = rootY + inner * tanS;
  const kinkChord = chord * (1 - (1 - taper) * rakeAt);

  const points: Array<[number, number]> = [
    [rootX, rootY],
    [kinkX, kinkY],
  ];

  if (tip === 'raked') {
    const outer = semi - inner;
    const tipX = rootX + semi;
    const tipY = kinkY + outer * Math.tan(rad(sweep + 22));
    points.push([tipX, tipY], [tipX, tipY + chord * taper * 0.62]);
  } else {
    points.push([kinkX, kinkY + kinkChord]);
  }

  points.push([rootX, rootY + chord]);

  const shapes = [mirrored(cx, points)];

  // The tick a winglet casts on the ground. Small on purpose: this is the one
  // part of the drawing that is standing up rather than lying flat.
  if (tip === 'winglet') {
    const tipX = rootX + semi;
    shapes.push(
      mirrored(cx, [
        [tipX - chord * taper * 0.1, kinkY - chord * 0.14],
        [tipX + chord * taper * 0.16, kinkY - chord * 0.06],
        [tipX + chord * taper * 0.16, kinkY + kinkChord * 0.55],
        [tipX - chord * taper * 0.1, kinkY + kinkChord * 0.5],
      ]),
    );
  }

  return shapes;
}

/** A nacelle, drawn as a plain rounded box hanging ahead of the wing. */
function nacelle(x: number, y: number, len: number, width: number): string {
  const r = width * 0.42;
  return [
    `M ${n(x - width / 2)} ${n(y + r)}`,
    `A ${n(width / 2)} ${n(r)} 0 0 1 ${n(x + width / 2)} ${n(y + r)}`,
    `L ${n(x + width / 2)} ${n(y + len - r)}`,
    `A ${n(width / 2)} ${n(r)} 0 0 1 ${n(x - width / 2)} ${n(y + len - r)}`,
    'Z',
  ].join(' ');
}

/**
 * A fighter, built on its own rather than as a small airliner.
 *
 * The proportions are nothing like a transport: the nose is a third of the
 * aeroplane, the body is widest at the inlets and stays wide to the exhausts,
 * and the leading edge extensions ahead of the wing are most of what makes the
 * shape recognisable from above. Running those through the airliner builder
 * produced a fuselage with three triangles stacked down it.
 */
function fighter(spanFt: number, lengthFt: number, shape: Planform): Drawing {
  const k = FIT / Math.max(spanFt, lengthFt);
  const len = lengthFt * k;
  const semi = (spanFt * k) / 2;
  const cx = BOX / 2;
  const top = (BOX - len) / 2;
  const half = (shape.waist * len) / 2;
  /** Down the length, as a fraction of it. */
  const y = (f: number) => top + len * f;
  /** Out from the centreline, in fuselage half widths. */
  const h = (f: number) => cx + half * f;

  // Body: a short radome, then a forebody that reaches full width at the
  // inlets and holds it all the way to the exhausts. Tapering it the way an
  // airliner tapers turns the whole aeroplane into a dart.
  const paths = [
    mirrored(cx, [
      [cx, y(0)],
      [h(0.45), y(0.09)],
      [h(0.8), y(0.18)],
      [h(1), y(0.28)],
      [h(1), y(0.88)],
      [h(0.72), y(1)],
    ]),
  ];

  // Leading edge extensions: the wide blend from the cockpit into the wing
  // root, and the single feature that most says fighter from above.
  if (shape.strake !== false) {
    paths.push(
      mirrored(cx, [
        [h(0.6), y(shape.wingAt - 0.3)],
        [h(1.15), y(shape.wingAt - 0.14)],
        [h(1.5), y(shape.wingAt + 0.01)],
        [h(0.95), y(shape.wingAt + 0.04)],
      ]),
    );
  }

  const chord = len * shape.rootChord;
  const rootX = h(0.95);
  paths.push(
    ...panel(cx, rootX, y(shape.wingAt), semi - half * 0.95, chord, shape.taper, shape.sweep, 'plain'),
  );

  // Stabilators. Swept harder than the wing and much more tapered, so the
  // tail never reads as a second wing.
  paths.push(
    ...panel(
      cx,
      h(0.85),
      y(0.82),
      semi * 0.56 - half * 0.85,
      chord * 0.5,
      0.28,
      shape.sweep + 18,
      'plain',
    ),
  );

  // Fins, set outboard on the body and canted, which from above means each
  // one leans further out the further aft it goes. Placed off the span rather
  // than off the fuselage width: on a Hornet they stand well outboard, and
  // hard against the centreline they disappear into the body.
  const base = semi * (shape.fins === 2 ? 0.2 : 0);
  for (const side of shape.fins === 2 ? [1, -1] : [1]) {
    paths.push(
      poly([
        [cx + side * base, y(0.58)],
        [cx + side * (base + semi * 0.07), y(0.73)],
        [cx + side * (base + semi * 0.12), y(0.88)],
        [cx + side * (base + semi * 0.05), y(0.88)],
        [cx + side * (base - semi * 0.02), y(0.68)],
      ]),
    );
  }

  return { paths, viewBox: `0 0 ${BOX} ${BOX}` };
}

export function planform(spanFt: number, lengthFt: number, shape: Planform): Drawing {
  if (shape.family === 'fighter') return fighter(spanFt, lengthFt, shape);

  // Both dimensions are real, so the drawing is scaled by whichever of them
  // binds. A 747 and a Hornet then differ in proportion, not just in size.
  const k = FIT / Math.max(spanFt, lengthFt);
  const len = lengthFt * k;
  const semi = (spanFt * k) / 2;
  const cx = BOX / 2;
  const top = (BOX - len) / 2;

  const waist = shape.waist * len;
  const paths: string[] = [fuselage(cx, top, len, waist)];

  const rootX = cx + waist * 0.36;
  const rootY = top + len * shape.wingAt;
  const chord = len * shape.rootChord;
  paths.push(
    ...panel(cx, rootX, rootY, semi - waist * 0.36, chord, shape.taper, shape.sweep, shape.tip),
  );

  // Nacelles, spaced across the span the way real ones are: an inboard pair
  // about a third out, an outboard pair about two thirds.
  if (shape.engines > 0) {
    const stations = shape.engines === 4 ? [0.34, 0.62] : [shape.highWing ? 0.36 : 0.32];
    const nacLen = len * 0.11;
    const nacW = waist * (shape.highWing ? 0.42 : 0.48);
    for (const station of stations) {
      const x = cx + semi * station;
      // Hung ahead of the local leading edge, which is swept, so each engine
      // sits further aft the further out it is.
      const leY = rootY + (x - rootX) * Math.tan(rad(shape.sweep));
      const y = leY - nacLen * 0.72;
      paths.push(nacelle(x, y, nacLen, nacW), nacelle(cx - semi * station, y, nacLen, nacW));
    }
  }

  // Tailplane. Same generator as the wing, smaller and swept a little harder,
  // and kept far enough forward that it does not hang off the back of the
  // fuselage.
  const tailY = top + len * 0.86;
  const tailChord = chord * 0.5;
  paths.push(
    ...panel(
      cx,
      cx + waist * 0.28,
      tailY,
      semi * 0.33 - waist * 0.28,
      tailChord,
      0.42,
      shape.sweep + 8,
      'plain',
    ),
  );

  // Fins. Edge on from above, so each is a sliver rather than a shape, and a
  // pair is canted outboard.
  const finTop = top + len * 0.74;
  const finLen = len * 0.24;
  const finW = waist * 0.16;
  paths.push(
    mirrored(cx, [
      [cx + finW * 0.18, finTop],
      [cx + finW, finTop + finLen * 0.72],
      [cx + finW, finTop + finLen],
      [cx, finTop + finLen],
    ]),
  );

  return { paths, viewBox: `0 0 ${BOX} ${BOX}` };
}
