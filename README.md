# griffindthomas.com

Live at <https://griffindthomas.com>. Pushing to `main` rebuilds and deploys the
site automatically, which takes about a minute.

---

## The studio

Double click **Griffin studio** on your desktop, or `studio.cmd` in this folder.
A black window opens and the editor opens in your browser on its own. Keep that
window open while you work; closing it stops the studio. Nothing here is on the
internet, it only runs on this machine.

It has two tabs.

### Photos

- **Drag photos onto the drop zone.** They import straight away.
- **Edit any field** on any photo. It saves the moment you click out of the box.
- The **type code** box offers every code the site knows and names the family
  underneath as you type. If it says *Not on the type board*, that photo will
  show in the gallery and never on the type board, so fix it before publishing.

Photos with something missing get an orange bar down the left and a line saying
what they still need.

### Projects

Every project write-up, with its fields and its text. You can:

- **Edit anything**, including the write-up itself, which is markdown: a blank
  line starts a new paragraph and `## Something` is a heading.
- **Add or remove specification rows** with the buttons under that table.
- **Start a new project** with the box at the top. It begins hidden from the
  site, so you can leave it half written. Untick *Hide from site* when it is
  ready.

To delete a project, tick *Hide from site* and it disappears from the site while
the file stays put. Actually deleting the file is a thing to do in Explorer.

### Publishing

**Click Publish to site** when you are happy. That commits and pushes everything
you have changed, photos and projects together, and the live site updates about
a minute later. The button stays greyed out when there is nothing to publish.

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
| `npm run studio` | The editor at <http://localhost:4322>. Same as double clicking `studio.cmd` |
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
| Swim times | `data/swims-raw.tsv` (short course) and `data/swims-raw-lcm.tsv` (long course), then `node scripts/import-swims.mjs` |
| Log posts | `src/content/log/*.md`. The nav link appears on its own once one exists |

### Adding swim times

Paste from SwimCloud into the file for that course, four columns: time, flag,
meet, date. The flag column can be empty. Then run the importer.

**Keep the courses in separate files.** The importer works out the 50 from the
100 by how long the swim took, which is safe because the gap is wide. It cannot
tell yards from metres that way: a slow short course 100 and a fast long course
100 are both about 1:10. The file a time came from is what makes its course a
fact rather than a guess.

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
