/**
 * Map projection and polyline tools, shared by the map build scripts.
 *
 * Both maps on /trips are drawn as static SVG paths generated here and
 * committed, so nothing geographic ships to the browser: no map library, no
 * tile requests, no runtime projection. What the page loads is path data.
 *
 * The projection is Albers equal area conic with the standard USA parallels,
 * which is what a printed US map is drawn on. Equal area matters here for an
 * honest reason: on Web Mercator, Montana is the widest part of a crossing
 * because Mercator stretches everything away from the equator, and the whole
 * point of the driving map is that the width of a line means something.
 *
 * The maths is d3-geo's, reimplemented rather than depended on. These run once
 * on a laptop and produce a file; adding a dependency to the site for that
 * would be paying at every install for something used twice.
 */

const RADIANS = Math.PI / 180;
const { sin, cos, sqrt, abs, PI } = Math;

/**
 * Albers equal area conic.
 *
 * @param parallels The two standard parallels, degrees. Scale is true along
 *   these and distorts away from them, so they are set to bracket the
 *   latitudes that matter.
 * @param rotate Degrees of longitude to spin the globe by before projecting.
 *   Putting the region of interest on the central meridian is what keeps the
 *   cone from shearing it.
 * @param center The point, in already-rotated coordinates, that lands on
 *   `translate`.
 */
export function conicEqualArea({ parallels, rotate = 0, center = [0, 0], scale = 1, translate = [0, 0] }) {
  const y0 = parallels[0] * RADIANS;
  const y1 = parallels[1] * RADIANS;
  const sy0 = sin(y0);
  const n = (sy0 + sin(y1)) / 2;
  if (abs(n) < 1e-10) throw new Error('parallels are symmetric about the equator: the cone degenerates');
  const c = 1 + sy0 * (2 * n - sy0);
  const r0 = sqrt(c) / n;

  const raw = (lambda, phi) => {
    const r = sqrt(c - 2 * n * sin(phi)) / n;
    const t = lambda * n;
    return [r * sin(t), r0 - r * cos(t)];
  };

  // Longitude of the centre after rotation, wrapped so a rotation that pushes
  // a point past the antimeridian does not fly off to the far side.
  const wrap = (lambda) => {
    let v = lambda;
    while (v > PI) v -= 2 * PI;
    while (v < -PI) v += 2 * PI;
    return v;
  };

  const [cx, cy] = raw(center[0] * RADIANS, center[1] * RADIANS);
  const [tx, ty] = translate;

  return (lon, lat) => {
    const [px, py] = raw(wrap((lon + rotate) * RADIANS), lat * RADIANS);
    // y is negated: the maths has north as positive, the screen has it as up.
    return [tx + scale * (px - cx), ty + scale * (cy - py)];
  };
}

/** The projection a printed map of the United States is drawn on. */
export const albers = (scale = 1070, translate = [480, 250]) =>
  conicEqualArea({ parallels: [29.5, 45.5], rotate: 96, center: [-0.6, 38.7], scale, translate });

/**
 * The composite: the lower 48 on one cone, with Alaska and Hawaii on their own
 * and moved into the bottom left corner.
 *
 * Alaska is drawn at roughly a third scale, which is the convention on every
 * printed US map. It is a convention worth naming on the page rather than
 * leaving as a silent lie about how big Alaska is.
 */
export function albersUsa(scale = 1070, translate = [480, 250]) {
  const [x, y] = translate;
  return {
    lower48: albers(scale, translate),
    alaska: conicEqualArea({
      parallels: [55, 65],
      rotate: 154,
      center: [-2, 58.5],
      scale: 0.35 * scale,
      translate: [x - 0.307 * scale, y + 0.201 * scale],
    }),
    hawaii: conicEqualArea({
      parallels: [8, 18],
      rotate: 157,
      center: [-3, 19.9],
      scale,
      translate: [x - 0.205 * scale, y + 0.212 * scale],
    }),
  };
}

/** Perpendicular distance from p to the line ab. */
function perpendicular(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  return abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / len;
}

/**
 * Douglas-Peucker, iterative rather than recursive.
 *
 * A coastline ring out of Natural Earth runs to thousands of points, and the
 * recursive form blows the stack on the worst of them.
 */
export function simplify(points, tolerance) {
  if (points.length < 3) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  const stack = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop();
    let worst = 0;
    let index = -1;
    for (let i = first + 1; i < last; i += 1) {
      const d = perpendicular(points[i], points[first], points[last]);
      if (d > worst) {
        worst = d;
        index = i;
      }
    }
    if (index >= 0 && worst > tolerance) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }

  const out = [];
  for (let i = 0; i < points.length; i += 1) if (keep[i]) out.push(points[i]);
  return out;
}

/** Rounds to a fixed number of places without trailing zeroes. */
const fixed = (v, places) => {
  const s = v.toFixed(places);
  return s.replace(/\.?0+$/, '') || '0';
};

/**
 * Path data from a list of rings.
 *
 * Written without a separator between the `L` and its number, and with no
 * space between commands, because path data is the largest thing on these
 * pages and every character of it is shipped to every reader.
 */
export function toPath(rings, places = 1, close = true) {
  const parts = [];
  for (const ring of rings) {
    if (ring.length < 2) continue;
    let d = `M${fixed(ring[0][0], places)} ${fixed(ring[0][1], places)}`;
    let [lastX, lastY] = [null, null];
    for (let i = 1; i < ring.length; i += 1) {
      const x = fixed(ring[i][0], places);
      const y = fixed(ring[i][1], places);
      // Consecutive duplicates survive rounding and are pure waste.
      if (x === lastX && y === lastY) continue;
      d += `L${x} ${y}`;
      lastX = x;
      lastY = y;
    }
    parts.push(close ? `${d}Z` : d);
  }
  return parts.join('');
}

/** Every ring of a GeoJSON Polygon or MultiPolygon, as flat coordinate lists. */
export function ringsOf(geometry) {
  if (geometry.type === 'Polygon') return geometry.coordinates;
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.flat();
  throw new Error(`unexpected geometry ${geometry.type}`);
}

export function bounds(points) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}
