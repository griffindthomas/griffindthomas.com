// `z` is re-exported by astro:content but deprecated there in Astro 7; the
// direct import is the supported path and keeps one copy of zod in play.
import { z } from "zod";
import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";

import { AIRPORT_CODES } from "./data/airports";

/**
 * Photos.
 *
 * One JSON sidecar per photo, sitting next to the JPEG it describes in
 * `src/content/photos/`. Co-locating them means `image()` resolves a plain
 * relative path, the pair moves together in git, and the studio editor can
 * treat one slug as one unit.
 *
 * The split that matters: fields under `exif` and `source` are DERIVED and get
 * overwritten on every import, while everything above them is HAND-ENTERED and
 * never clobbered. `scripts/photos.mjs` enforces that, so re-running the
 * importer is always safe.
 */
const photos = defineCollection({
  loader: glob({ base: "./src/content/photos", pattern: "**/*.json" }),
  schema: ({ image }) =>
    z.object({
      /** The processed JPEG, co-located with this sidecar. */
      image: image(),
      /** Tiny inline base64 preview, so the grid never flashes empty boxes. */
      lqip: z.string(),

      // --- Hand-entered. Empty is honest; a guess is not. ------------------
      /** Full type name, e.g. "Boeing 787-9". */
      aircraft: z.string().default(""),
      /** Short ICAO type code, e.g. "B789". Used for compact plates. */
      typeCode: z.string().default(""),
      /** Airline, air arm, or owner. e.g. "Alaska Airlines", "US Navy". */
      operator: z.string().default(""),
      /** Civil registration or military serial. */
      registration: z.string().default(""),
      /** ICAO code, validated against src/data/airports.ts. */
      airport: z
        .string()
        .refine((v) => v === "" || AIRPORT_CODES.includes(v), {
          message: `airport must be "" or one of: ${AIRPORT_CODES.join(", ")}`,
        })
        .default(""),
      /** Free text for anywhere that is not an airport, e.g. "Seafair". */
      location: z.string().default(""),
      /** One line of context. Shown in the lightbox, never in the grid. */
      caption: z.string().default(""),
      /** Freeform, drives no layout. Useful for one-off grouping. */
      tags: z.array(z.string()).default([]),
      /** Promotes the photo to the home page and the top of the gallery. */
      featured: z.boolean().default(false),
      /** Lower sorts earlier within the same date. */
      order: z.number().default(0),
      /** Hide without deleting the files. */
      draft: z.boolean().default(false),

      /**
       * Local wall-clock time the shutter fired, "YYYY-MM-DDTHH:MM:SS".
       * No offset and no trailing Z, because EXIF carries no timezone: the
       * zone this clock belongs to is recorded separately below.
       *
       * Derived once from EXIF at import, then left alone, so a correction
       * made in the studio survives the next import.
       */
      shotAt: z.string(),
      /** IANA zone `shotAt` is expressed in. */
      timezone: z.string().default("America/Los_Angeles"),

      // --- Derived. Overwritten on every import. ---------------------------
      exif: z
        .object({
          camera: z.string().default(""),
          lens: z.string().default(""),
          focalLength: z.number().nullable().default(null),
          aperture: z.number().nullable().default(null),
          shutter: z.string().default(""),
          iso: z.number().nullable().default(null),
          /** Raw EXIF timestamp, unconverted. Kept for auditing `shotAt`. */
          rawDate: z.string().default(""),
        })
        .prefault({}),
      source: z
        .object({
          /** Original filename in the inbox, for tracing back to Lightroom. */
          file: z.string().default(""),
          width: z.number().default(0),
          height: z.number().default(0),
          bytes: z.number().default(0),
          /** Long edge of the original, before the import downscale. */
          originalLongEdge: z.number().default(0),
        })
        .prefault({}),
    }),
});

/**
 * Projects. Markdown body so the write-up can be edited as prose; the spec
 * table is structured so it renders as a real data table rather than a list
 * someone has to keep aligned by hand.
 */
const projects = defineCollection({
  loader: glob({ base: "./src/content/projects", pattern: "**/*.{md,mdx}" }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      /** One line, shown in the index. No trailing full stop. */
      summary: z.string(),
      /** "Active", "Shelved", "Complete" - shown as status in the plate. */
      status: z.string().default("Active"),
      /** Year or range, e.g. "2025" or "2024-2026". */
      period: z.string(),
      /** Ordered spec rows. Mono table, tabular figures. */
      specs: z.array(z.object({ label: z.string(), value: z.string() })).default([]),
      /** Tools and materials. Rendered as a rule-separated run, not chips. */
      stack: z.array(z.string()).default([]),
      /** Lower sorts first on the index. */
      order: z.number().default(0),
      draft: z.boolean().default(false),
      /**
       * Photographs of the thing itself, in order, shown under the write-up.
       *
       * `src` is a path relative to this markdown file, so the files live in
       * `src/content/projects/images/` and go through the same build-time
       * optimisation as the gallery rather than being served untouched out of
       * `public/`. A path that does not resolve fails the build.
       */
      photos: z
        .array(
          z.object({
            src: image(),
            /** What is in the frame, for anyone who cannot see it. */
            alt: z.string().default(""),
            /** Printed under the photograph. Optional. */
            caption: z.string().default(""),
          }),
        )
        .default([]),
    }),
});

/**
 * Log. Empty today. The nav hides the section until an entry exists, so
 * shipping this collection early costs nothing and adding a post is a
 * one-file change.
 */
const log = defineCollection({
  loader: glob({ base: "./src/content/log", pattern: "**/*.{md,mdx}" }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    date: z.coerce.date(),
    draft: z.boolean().default(false),
  }),
});

export const collections = { photos, projects, log };
