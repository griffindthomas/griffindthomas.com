import { getCollection, type CollectionEntry } from "astro:content";

/**
 * `getCollection("log")` warns "the collection does not exist or is empty"
 * every time it is called against an empty folder, and the nav calls it on
 * every page, so a build prints that line once per route. The collection is
 * defined and ready; there is simply nothing written yet.
 *
 * `import.meta.glob` answers "are there any files" at build time without
 * touching the content layer, so the loader is only asked for entries once
 * there is something to load.
 */
const files = import.meta.glob("../content/log/*.{md,mdx}");

export const hasLogFiles = Object.keys(files).length > 0;

export async function loadLog(): Promise<CollectionEntry<"log">[]> {
  if (!hasLogFiles) return [];

  const entries = await getCollection("log", ({ data }) => !data.draft);
  return entries.sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());
}
