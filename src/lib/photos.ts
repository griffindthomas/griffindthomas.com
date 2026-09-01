import { getCollection, type CollectionEntry } from "astro:content";
import { getImage } from "astro:assets";

import { airport, type Airport } from "../data/airports";

export type PhotoEntry = CollectionEntry<"photos">;

export interface Photo {
  slug: string;
  data: PhotoEntry["data"];
  /** Resolved airport record, or null for anywhere that is not an airport. */
  field: Airport | null;
  /** What to print as the place: an IATA code, or the free-text location. */
  place: string;
  /** Long form, for the lightbox. */
  placeLong: string;
  /** "02 AUG 2026" */
  date: string;
  /** "14:34 PDT" */
  time: string;
  year: number;
  aspect: number;
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/**
 * `shotAt` is a naive local wall clock with no offset, which is the only
 * honest way to store it: EXIF has no timezone. So it is formatted by string
 * surgery rather than by `new Date()`, which would reinterpret it in whatever
 * zone the build machine happens to sit in and slide dates across midnight.
 */
export function formatDate(shotAt: string): string {
  const [y, m, d] = shotAt.slice(0, 10).split("-");
  return `${d} ${MONTHS[Number(m) - 1]} ${y}`;
}

export function formatTime(shotAt: string, timezone: string): string {
  const clock = shotAt.slice(11, 16);
  // Abbreviation for the zone on that calendar date. Anchored at 12:00 UTC so
  // a DST transition, which always happens in the small hours, cannot land on
  // the wrong side of the boundary.
  const anchor = new Date(`${shotAt.slice(0, 10)}T12:00:00Z`);
  const abbr =
    new Intl.DateTimeFormat("en-US", { timeZone: timezone, timeZoneName: "short" })
      .formatToParts(anchor)
      .find((p) => p.type === "timeZoneName")?.value ?? "";
  return `${clock} ${abbr}`.trim();
}

function decorate(entry: PhotoEntry): Photo {
  const field = airport(entry.data.airport);
  const { width, height } = entry.data.image;

  return {
    slug: entry.id,
    data: entry.data,
    field,
    place: field ? field.iata : entry.data.location,
    placeLong: field ? `${field.name}, ${field.city}` : entry.data.location,
    date: formatDate(entry.data.shotAt),
    time: formatTime(entry.data.shotAt, entry.data.timezone),
    year: Number(entry.data.shotAt.slice(0, 4)),
    aspect: width / height,
  };
}

/** Newest first. `order` breaks ties within a burst shot seconds apart. */
export async function loadPhotos(): Promise<Photo[]> {
  const entries = await getCollection("photos", ({ data }) => !data.draft);
  return entries
    .map(decorate)
    .sort((a, b) =>
      b.data.shotAt.localeCompare(a.data.shotAt) || a.data.order - b.data.order,
    );
}

/**
 * Full-size rendition for the lightbox, generated at build time.
 *
 * Clamped to the stored width so the four JetPhotos-sized frames are never
 * upscaled: enlarging a 1280px file produces a bigger, softer image and a
 * bigger download for no extra detail.
 */
export async function lightboxSrc(photo: Photo): Promise<string> {
  const img = await getImage({
    src: photo.data.image,
    width: Math.min(2000, photo.data.image.width),
    format: "webp",
    quality: 82,
  });
  return img.src;
}

/** The numbers under the gallery heading. All computed, never hand-typed. */
export function galleryStats(photos: Photo[]) {
  const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))];
  const fields = uniq(photos.map((p) => p.data.airport));
  const types = uniq(photos.map((p) => p.data.aircraft));
  const operators = uniq(photos.map((p) => p.data.operator));
  const dates = photos.map((p) => p.data.shotAt).sort();

  return {
    count: photos.length,
    fields: fields.length,
    types: types.length,
    operators: operators.length,
    /** Longest lens actually used, which is the real limit on reach. */
    longestLens: Math.max(0, ...photos.map((p) => p.data.exif.focalLength ?? 0)),
    first: dates[0] ? formatDate(dates[0]) : "",
    latest: dates.at(-1) ? formatDate(dates.at(-1)!) : "",
  };
}

export interface FilterGroup {
  id: string;
  label: string;
  options: { value: string; label: string; count: number }[];
}

/**
 * Filter groups, built from whatever is actually in the library.
 *
 * A group with fewer than two options is dropped: a filter offering one
 * choice that selects every photo is noise, and with a library this size that
 * happens often. This is also why the bar is built here rather than hardcoded
 * - it grows honestly as photos are added.
 */
export function buildFilters(photos: Photo[]): FilterGroup[] {
  const tally = (pick: (p: Photo) => string | string[]) => {
    const counts = new Map<string, number>();
    for (const p of photos) {
      const vals = pick(p);
      for (const v of Array.isArray(vals) ? vals : [vals]) {
        if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
      }
    }
    return counts;
  };

  const groups: FilterGroup[] = [
    {
      id: "operator",
      label: "Operator",
      options: [...tally((p) => p.data.operator)]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([value, count]) => ({ value, label: value, count })),
    },
    {
      id: "aircraft",
      label: "Type",
      options: [...tally((p) => p.data.aircraft)]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([value, count]) => ({ value, label: value, count })),
    },
    {
      id: "place",
      label: "Where",
      options: [...tally((p) => (p.data.airport ? p.data.airport : p.data.location))]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([value, count]) => ({
          value,
          label: airport(value)?.iata ?? value,
          count,
        })),
    },
    {
      id: "tag",
      label: "Subject",
      options: [...tally((p) => p.data.tags)]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([value, count]) => ({
          value,
          label: value[0].toUpperCase() + value.slice(1),
          count,
        })),
    },
  ];

  return groups.filter((g) => g.options.length > 1);
}
