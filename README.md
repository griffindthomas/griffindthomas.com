# griffindthomas.com

Live at <https://griffindthomas.com>. Pushing to `main` rebuilds and deploys the
site automatically, which takes about a minute.

---

## Adding photos, on your own

You do not need to touch code or ask anyone. Open a terminal in this folder and
run:

```bash
npm run studio
```

A page opens in your browser. From there you can:

- **Drag photos onto the drop zone.** They import straight away.
- **Edit any field** on any photo. It saves the moment you click out of the box.
- **Click Publish to site** when you are happy. That commits and pushes, and the
  live site updates about a minute later.

Photos with something missing get an orange bar down the left and a line saying
what they still need.

### About duplicates

Drop in every export you have. If you have `_MG_1141.jpg` and `_MG_1141_1.jpg`
of the same frame, the importer keeps whichever has the most pixels and ignores
the rest. It counts pixels rather than trusting the filename, because the `_1`
suffix does **not** reliably mean the smaller file. On some of your frames it is
the other way round.

### What gets stored

The originals stay in Lightroom and OneDrive. The importer writes a 2800px copy
into `src/content/photos/` and that is what ships. Full 22 MP originals in the
repo would bloat it for no visible gain, since the site resizes them anyway.

### If you would rather edit files directly

Every photo is two files sitting next to each other in `src/content/photos/`:
the JPEG, and a `.json` file with its metadata. Editing the JSON by hand does
exactly the same thing the studio does.

Re-running the importer never overwrites anything you typed. It only refreshes
the technical fields (`exif`, `source`, `image`, `lqip`).

### Adding an airport

Airport codes are validated, so a typo fails the build rather than quietly
producing a broken filter. To use a new one, add it to
`src/data/airports.json` first and it appears in the studio dropdown.

---

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Local site at <http://localhost:4321> |
| `npm run studio` | Photo editor at <http://localhost:4322> |
| `npm run photos` | Import from `photos-inbox/` without opening the studio |
| `npm run build` | Production build |
| `npm run check` | Typecheck. Run before pushing |
| `npm run preview` | Serve the built site on the real Cloudflare runtime |
| `npm run preview:stop` | Stop that server. Do this before building again |

`npm run photos -- --from "C:/some/folder"` imports from anywhere, and
`-- --force` re-encodes even when a photo is already current.

---

## Editing the rest of the site

| What | Where |
| --- | --- |
| Links, email address, site name | `src/config/site.ts` |
| Projects | `src/content/projects/*.md` |
| Resume | `src/pages/resume.astro`, and `public/griffin-thomas-resume.pdf` |
| Swim times | `data/swims-raw.tsv`, then `node scripts/import-swims.mjs` |
| Log posts | `src/content/log/*.md`. The nav link appears on its own once one exists |

---

## Writing

No em dashes. Use commas, full stops, or the `/` the site uses everywhere else.
Check with:

```bash
grep -rn "—\|–" src/
```

Avoid three-adjective lists, tidy summarising closers, and anything that reads
like a LinkedIn summary. Concrete nouns and admitted faults work better. "The
first ones flew nose-heavy" beats any amount of polish.

---

Notes on the stack, and the traps worth knowing about, are in `CLAUDE.md`.
