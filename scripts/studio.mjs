/**
 * Studio: a local editor for the parts of the site that are content.
 *
 *   npm run studio        (or double click studio.cmd)
 *
 * Opens a small web page on localhost with two tabs. Photos lists every frame
 * in the library with its fields as form inputs and accepts new ones by drag
 * and drop. Projects lists every project write-up with its frontmatter as
 * fields and its markdown in a box. Either can be committed and pushed from
 * the same button.
 *
 * It exists so that changing an airport code, or fixing a date in a write-up,
 * is a thing Griffin does in thirty seconds rather than a thing he has to ask
 * someone to do for him.
 *
 * Photos: it edits the SAME JSON sidecars the importer writes, and only ever
 * touches the hand-entered keys, so the two tools cannot fight over a file.
 * Projects: it reads and writes the same markdown files the site builds from,
 * frontmatter through a real YAML parser rather than a guess at the format.
 *
 * Bound to 127.0.0.1 on purpose. This process writes files, runs the importer
 * and can push to git; it must never be reachable from the network.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import sharp from 'sharp';
import YAML from 'yaml';

import { INBOX, LIBRARY, findGaps, runImport } from './photos.mjs';

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.STUDIO_PORT ?? 4322);

/** Keys the studio is allowed to write. Everything else is derived by the
 *  importer, and letting the editor touch it would just get overwritten. */
const EDITABLE = new Set([
  'aircraft',
  'typeCode',
  'operator',
  'registration',
  'airport',
  'location',
  'caption',
  'tags',
  'featured',
  'order',
  'draft',
  'shotAt',
  'timezone',
]);

const airports = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'src', 'data', 'airports.json'), 'utf8'),
);

/**
 * The same catalogue the type board is built from, read straight from the
 * file the site reads. The board counts a photo by its type code, so a code
 * that is not in here means the photo shows in the gallery and never appears
 * on the board, with nothing to say so. The editor offers the real codes and
 * names the family, which is the only place that mistake can be caught.
 */
const aircraftTypes = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'src', 'data', 'aircraft-types.json'), 'utf8'),
);

/** Flat list of every known code, with the family it belongs to. */
const typeCodes = aircraftTypes
  .flatMap((family) => family.codes.map((code) => ({ code, family: family.name })))
  .sort((a, b) => a.code.localeCompare(b.code));

const sidecarPath = (slug) => path.join(LIBRARY, `${slug}.json`);

// --- projects ---------------------------------------------------------------

const PROJECTS = path.join(ROOT, 'src', 'content', 'projects');

const projectPath = (slug) => path.join(PROJECTS, `${slug}.md`);

/**
 * Split a markdown file into its frontmatter and its body.
 *
 * Returns null rather than guessing when the file does not open with a
 * frontmatter block, so a file this tool cannot read is shown as unreadable
 * instead of being silently rewritten into something else.
 */
function splitFrontmatter(raw) {
  const lines = raw.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return null;
  const end = lines.indexOf('---', 1);
  if (end === -1) return null;
  return {
    frontmatter: lines.slice(1, end).join('\n'),
    body: lines
      .slice(end + 1)
      .join('\n')
      .replace(/^\n+/, ''),
  };
}

function readProjects() {
  if (!fs.existsSync(PROJECTS)) return [];
  return fs
    .readdirSync(PROJECTS)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const slug = f.replace(/\.md$/, '');
      const raw = fs.readFileSync(path.join(PROJECTS, f), 'utf8');
      const parts = splitFrontmatter(raw);
      if (!parts) return { slug, unreadable: 'No frontmatter block' };
      try {
        return { slug, data: YAML.parse(parts.frontmatter) ?? {}, body: parts.body };
      } catch (err) {
        return { slug, unreadable: String(err?.message ?? err) };
      }
    })
    .sort((a, b) => (a.data?.order ?? 999) - (b.data?.order ?? 999));
}

/**
 * What the content schema insists on. Checking here means a missing title is
 * a message next to the field rather than a failed build ten minutes later,
 * with the site still serving the last good version in the meantime.
 */
function validateProject(data) {
  for (const key of ['title', 'summary', 'period']) {
    if (!String(data[key] ?? '').trim()) return `${key} cannot be empty`;
  }
  if (!Number.isFinite(data.order)) return 'order has to be a number';
  return null;
}

/** Where project photographs live, next to the write-ups that reference them. */
const PROJECT_IMAGES = path.join(PROJECTS, 'images');

/**
 * Store a dropped photograph beside the write-ups and return the path the
 * frontmatter should carry.
 *
 * Resized on the way in for the same reason the gallery does it: a 20 MP
 * original in the repository is bytes nobody ever downloads, since the build
 * generates its own sizes from whatever is here. Big enough that a full width
 * figure still has detail, and no bigger.
 */
async function storeProjectImage(slug, buffer) {
  fs.mkdirSync(PROJECT_IMAGES, { recursive: true });

  // Never overwrite: two photographs of the same thing are the normal case.
  let n = 1;
  let name = `${slug}-${n}.jpg`;
  while (fs.existsSync(path.join(PROJECT_IMAGES, name))) name = `${slug}-${++n}.jpg`;

  await sharp(buffer)
    .rotate() // honour the EXIF orientation flag before it is stripped
    .resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82, mozjpeg: true })
    .toFile(path.join(PROJECT_IMAGES, name));

  return `./images/${name}`;
}

/** Only the keys the form owns, cleaned up, in a stable order. */
function cleanProject(input) {
  const data = {
    title: String(input.title ?? '').trim(),
    summary: String(input.summary ?? '').trim(),
    status: String(input.status ?? '').trim() || 'Active',
    period: String(input.period ?? '').trim(),
    order: Number(input.order ?? 0),
    // Rows with nothing in them are how a spec table ends up with holes.
    specs: (Array.isArray(input.specs) ? input.specs : [])
      .map((row) => ({
        label: String(row?.label ?? '').trim(),
        value: String(row?.value ?? '').trim(),
      }))
      .filter((row) => row.label || row.value),
    stack: (Array.isArray(input.stack) ? input.stack : [])
      .map((tool) => String(tool ?? '').trim())
      .filter(Boolean),
    // Kept in the order they arrive. A photograph with no path is not a
    // photograph, and the build would fail on it.
    photos: (Array.isArray(input.photos) ? input.photos : [])
      .map((photo) => ({
        src: String(photo?.src ?? '').trim(),
        alt: String(photo?.alt ?? '').trim(),
        caption: String(photo?.caption ?? '').trim(),
      }))
      .filter((photo) => photo.src),
    draft: Boolean(input.draft),
  };
  return data;
}

function writeProject(slug, data, body) {
  const frontmatter = YAML.stringify(data, { lineWidth: 0 }).trimEnd();
  fs.writeFileSync(projectPath(slug), `---\n${frontmatter}\n---\n\n${String(body).trim()}\n`);
}

/** Filename from the title: lowercase, words joined by hyphens, nothing else. */
function slugify(title) {
  return String(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function readLibrary() {
  if (!fs.existsSync(LIBRARY)) return [];
  return fs
    .readdirSync(LIBRARY)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const slug = f.replace(/\.json$/, '');
      return { slug, ...JSON.parse(fs.readFileSync(path.join(LIBRARY, f), 'utf8')) };
    })
    .sort((a, b) => String(b.shotAt).localeCompare(String(a.shotAt)));
}

async function git(...args) {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd: ROOT,
      // No terminal is attached to this subprocess. Without this, an expired
      // credential makes `git push` block forever on a prompt nobody can see
      // and the Publish button just spins. Fail fast and show the error.
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    return { ok: true, out: stdout.trim() };
  } catch (err) {
    return { ok: false, out: `${err.stdout ?? ''}${err.stderr ?? ''}`.trim() || String(err) };
  }
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(payload);
}

function readBody(req, limit = 60 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  try {
    // --- page ------------------------------------------------------------
    if (req.method === 'GET' && url.pathname === '/') {
      const html = fs.readFileSync(path.join(HERE, 'studio.html'));
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(html);
    }

    // --- thumbnails: served straight from the library --------------------
    if (req.method === 'GET' && url.pathname.startsWith('/img/')) {
      // basename() so a crafted path cannot climb out of the library folder.
      const file = path.join(LIBRARY, path.basename(url.pathname.slice(5)));
      if (!fs.existsSync(file)) {
        res.writeHead(404);
        return res.end('not found');
      }
      res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'no-store' });
      return res.end(fs.readFileSync(file));
    }

    // --- a project photograph, for the thumbnails in the editor -----------
    if (req.method === 'GET' && url.pathname.startsWith('/project-img/')) {
      // basename() so a crafted path cannot climb out of the images folder.
      const file = path.join(PROJECT_IMAGES, path.basename(url.pathname.slice(13)));
      if (!fs.existsSync(file)) {
        res.writeHead(404);
        return res.end('not found');
      }
      res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'no-store' });
      return res.end(fs.readFileSync(file));
    }

    // --- current state ---------------------------------------------------
    if (req.method === 'GET' && url.pathname === '/api/state') {
      const status = await git('status', '--porcelain');
      const changed = status.ok ? status.out.split('\n').filter(Boolean) : [];
      return json(res, 200, {
        photos: readLibrary(),
        projects: readProjects(),
        gaps: findGaps(),
        airports,
        typeCodes,
        inbox: fs.existsSync(INBOX)
          ? fs.readdirSync(INBOX).filter((f) => /\.(jpe?g|png|tiff?|webp)$/i.test(f))
          : [],
        git: { available: status.ok, changed },
      });
    }

    // --- git status only -------------------------------------------------
    // Separate from /api/state so a save can refresh the Publish button
    // without re-sending every photo and re-rendering the cards underneath
    // whatever field is being edited.
    if (req.method === 'GET' && url.pathname === '/api/status') {
      const status = await git('status', '--porcelain');
      return json(res, 200, {
        changed: status.ok ? status.out.split('\n').filter(Boolean) : [],
        gaps: findGaps(),
        photoCount: readLibrary().length,
      });
    }

    // --- save one photo --------------------------------------------------
    if (req.method === 'POST' && url.pathname === '/api/save') {
      const { slug, patch } = JSON.parse((await readBody(req)).toString('utf8'));
      const file = sidecarPath(slug);
      if (!fs.existsSync(file)) return json(res, 404, { error: 'no such photo' });

      const entry = JSON.parse(fs.readFileSync(file, 'utf8'));
      for (const [k, v] of Object.entries(patch)) {
        if (EDITABLE.has(k)) entry[k] = v;
      }

      // Guard the one field with a closed vocabulary. The content schema
      // rejects an unknown code at build time; failing here instead means the
      // mistake is visible while the person who made it is still looking.
      if (entry.airport && !airports[entry.airport]) {
        return json(res, 400, { error: `Unknown airport code: ${entry.airport}` });
      }

      fs.writeFileSync(file, `${JSON.stringify(entry, null, 2)}\n`);
      return json(res, 200, { ok: true, entry });
    }

    // --- save one project ------------------------------------------------
    if (req.method === 'POST' && url.pathname === '/api/project') {
      const { slug, data, body } = JSON.parse((await readBody(req)).toString('utf8'));
      if (!/^[a-z0-9-]+$/.test(String(slug))) return json(res, 400, { error: 'bad slug' });
      if (!fs.existsSync(projectPath(slug))) return json(res, 404, { error: 'no such project' });

      const clean = cleanProject(data);
      const problem = validateProject(clean);
      if (problem) return json(res, 400, { error: problem });

      // Anything in the file that this form does not know about is kept. The
      // schema can grow a key, or Griffin can add one by hand, and saving a
      // title from here must not quietly delete it. Same rule as the photo
      // sidecars: the editor owns its fields and nothing else.
      const existing = readProjects().find((p) => p.slug === slug);
      if (existing?.unreadable) return json(res, 400, { error: existing.unreadable });
      const merged = { ...(existing?.data ?? {}), ...clean };

      writeProject(slug, merged, body ?? '');
      return json(res, 200, { ok: true, data: merged });
    }

    // --- start a new project ----------------------------------------------
    if (req.method === 'POST' && url.pathname === '/api/project/new') {
      const { title } = JSON.parse((await readBody(req)).toString('utf8'));
      const base = slugify(title || 'new-project') || 'new-project';

      // Never overwrite an existing write-up because two of them happen to
      // start with the same word.
      let slug = base;
      let n = 2;
      while (fs.existsSync(projectPath(slug))) slug = `${base}-${n++}`;

      const order = Math.max(0, ...readProjects().map((p) => Number(p.data?.order ?? 0))) + 1;
      const data = cleanProject({
        title: String(title || '').trim() || 'Untitled project',
        // Placeholders the schema will accept, so the site keeps building
        // while this is half written. It is a draft until it is not.
        summary: 'One line about what this is',
        status: 'Active',
        period: String(new Date().getFullYear()),
        order,
        specs: [],
        stack: [],
        draft: true,
      });
      writeProject(slug, data, 'Write-up goes here.');
      return json(res, 200, { ok: true, slug });
    }

    // --- add a photograph to a project ------------------------------------
    if (req.method === 'POST' && url.pathname === '/api/project/photo') {
      const slug = url.searchParams.get('slug') ?? '';
      if (!/^[a-z0-9-]+$/.test(slug)) return json(res, 400, { error: 'bad slug' });

      const project = readProjects().find((p) => p.slug === slug);
      if (!project) return json(res, 404, { error: 'no such project' });
      if (project.unreadable) return json(res, 400, { error: project.unreadable });

      const name = path.basename(url.searchParams.get('name') ?? '');
      if (!/\.(jpe?g|png|tiff?|webp|heic)$/i.test(name)) {
        return json(res, 400, { error: `Not an image: ${name}` });
      }

      const src = await storeProjectImage(slug, await readBody(req));
      const data = cleanProject({
        ...project.data,
        photos: [...(project.data.photos ?? []), { src, alt: '', caption: '' }],
      });
      writeProject(slug, { ...project.data, ...data }, project.body);
      return json(res, 200, { ok: true, src });
    }

    // --- accept a dropped file ------------------------------------------
    if (req.method === 'POST' && url.pathname === '/api/upload') {
      const name = path.basename(url.searchParams.get('name') ?? '');
      if (!/\.(jpe?g|png|tiff?|webp)$/i.test(name)) {
        return json(res, 400, { error: `Not an image: ${name}` });
      }
      fs.mkdirSync(INBOX, { recursive: true });
      fs.writeFileSync(path.join(INBOX, name), await readBody(req));
      return json(res, 200, { ok: true, name });
    }

    // --- run the importer over the inbox ---------------------------------
    if (req.method === 'POST' && url.pathname === '/api/import') {
      const lines = [];
      const { imported } = await runImport({ log: (l) => lines.push(l) });
      return json(res, 200, { ok: true, log: lines, count: imported.length });
    }

    // --- commit and push -------------------------------------------------
    if (req.method === 'POST' && url.pathname === '/api/publish') {
      const { message } = JSON.parse((await readBody(req)).toString('utf8'));
      const status = await git('status', '--porcelain');
      if (!status.ok) return json(res, 400, { error: 'Not a git repository' });
      if (!status.out) return json(res, 200, { ok: true, log: ['Nothing to publish'] });

      const log = [];
      for (const step of [
        ['add', '-A'],
        ['commit', '-m', message || 'Update photos'],
        ['push'],
      ]) {
        const r = await git(...step);
        log.push(`$ git ${step.join(' ')}\n${r.out}`);
        if (!r.ok) return json(res, 500, { error: `git ${step[0]} failed`, log });
      }
      return json(res, 200, { ok: true, log });
    }

    res.writeHead(404);
    res.end('not found');
  } catch (err) {
    json(res, 500, { error: String(err?.message ?? err) });
  }
});

const address = `http://localhost:${PORT}`;

/** Best effort. If it fails the URL is printed in the console anyway. */
function openBrowser() {
  if (process.argv.includes('--no-open')) return;
  if (process.platform === 'win32') execFile('cmd', ['/c', 'start', '', address], () => {});
  else if (process.platform === 'darwin') execFile('open', [address], () => {});
  else execFile('xdg-open', [address], () => {});
}

/**
 * A second copy is not an error worth a stack trace.
 *
 * Double clicking the launcher twice is the most likely way to get here, and
 * the first copy is already serving the page. Open that instead of printing
 * an EADDRINUSE trace at someone who only wanted to edit a caption.
 */
server.on('error', (err) => {
  if (err?.code === 'EADDRINUSE') {
    console.log(`\n  Studio is already open at ${address}\n`);
    openBrowser();
    setTimeout(() => process.exit(0), 500);
    return;
  }
  console.error(err);
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  Studio  ${address}\n`);
  console.log(`  Photos    ${path.relative(ROOT, LIBRARY)}`);
  console.log(`  Inbox     ${path.relative(ROOT, INBOX)}`);
  console.log(`  Projects  ${path.relative(ROOT, PROJECTS)}`);
  console.log('\n  Close this window to stop.\n');

  openBrowser();
});
