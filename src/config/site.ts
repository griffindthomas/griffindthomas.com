/**
 * Single source of truth for identity and off-site links.
 *
 * Everything that appears in more than one place lives here: the nav, the
 * footer, /contact, the About page and the JSON-LD all read from this file.
 * Changing a handle should be a one-line edit, not a grep.
 */

export const SITE = {
  name: "Griffin Thomas",
  domain: "griffindthomas.com",
  url: "https://griffindthomas.com",
  tagline:
    "Aerospace engineering student at Arizona State. I build RC aircraft and photograph airliners at Sea-Tac, Boeing Field, and Sky Harbor.",
  /**
   * ONE constant, deliberately. This address is routed through Cloudflare
   * Email Routing today and Google Workspace is a likely later migration;
   * that swap changes MX and DKIM records, not this string.
   *
   * It is already printed in the resume PDF, so it must keep working.
   */
  email: "contact@griffindthomas.com",
  /** Sky Harbor. Used by the footer readout and the home page dateline. */
  base: {
    label: "Tempe, Arizona",
    lat: 33.4342,
    lon: -112.0116,
  },
  /**
   * West Seattle.
   *
   * The home page prints THESE coordinates under the Tempe label, which looks
   * like a mistake and is not one. The label is where he is; the numbers are
   * where he is from. Anyone who reads coordinates will notice they disagree,
   * and that is the point of them being there.
   */
  home: {
    label: "Seattle, Washington",
    lat: 47.5707,
    lon: -122.3868,
  },
} as const;

/**
 * Coordinates as they are printed on this site: four decimal places, hemisphere
 * as a letter in front. One function, because the home page and the footer both
 * print a pair and they must not drift into two formats.
 */
export const coordinates = (lat: number, lon: number) =>
  `${lat >= 0 ? "N" : "S"}${Math.abs(lat).toFixed(4)} ${lon >= 0 ? "E" : "W"}${Math.abs(lon).toFixed(4)}`;

/**
 * Off-site profiles. `handle` is what gets displayed, so the link text is the
 * account itself rather than a bare platform name: a reader can see which
 * account they are about to open.
 *
 * No JetPhotos entry: nothing has been approved there yet, and linking an
 * empty profile is worse than linking none.
 */
export const PROFILES = [
  {
    id: "linkedin",
    label: "LinkedIn",
    handle: "in/griffindthomas",
    href: "https://www.linkedin.com/in/griffindthomas/",
    note: "Work history and coursework",
  },
  {
    id: "instagram",
    label: "Instagram",
    handle: "@griffin.t41",
    href: "https://www.instagram.com/griffin.t41/",
    note: "Aircraft photography, posted as I shoot it",
  },
  {
    id: "swimcloud",
    label: "SwimCloud",
    handle: "griffindthomas",
    href: "https://www.swimcloud.com/swimmer/2566888/",
    note: "Every race, officially timed",
  },
  {
    id: "github",
    label: "GitHub",
    handle: "@griffindthomas",
    href: "https://github.com/griffindthomas",
    note: "Including the source of this site",
  },
] as const;

export const RESUME_PDF = "/griffin-thomas-resume.pdf";

/** Convenience lookup so a page can pull one profile without filtering. */
export const profile = (id: (typeof PROFILES)[number]["id"]) => {
  const found = PROFILES.find((p) => p.id === id);
  if (!found) throw new Error(`Unknown profile: ${id}`);
  return found;
};
