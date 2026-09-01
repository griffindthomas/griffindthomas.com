/**
 * Photo studio: a local editor for photo metadata.
 *
 *   npm run studio
 *
 * Opens a small web page on localhost that lists every photo in the library
 * with its fields as form inputs, accepts new photos by drag and drop, and can
 * commit and push the result. It exists so that changing an airport code or
 * adding a caption is a thing Griffin does in thirty seconds, not a thing he
 * has to ask someone to do for him.
 *
 * It edits the SAME JSON sidecars the importer writes, and only ever touches
 * the hand-entered keys, so the two tools cannot fight over a file.
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

const sidecarPath = (slug) => path.join(LIBRARY, `${slug}.json`);

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

    // --- current state ---------------------------------------------------
    if (req.method === 'GET' && url.pathname === '/api/state') {
      const status = await git('status', '--porcelain');
      const changed = status.ok ? status.out.split('\n').filter(Boolean) : [];
      return json(res, 200, {
        photos: readLibrary(),
        gaps: findGaps(),
        airports,
        inbox: fs.existsSync(INBOX)
          ? fs.readdirSync(INBOX).filter((f) => /\.(jpe?g|png|tiff?|webp)$/i.test(f))
          : [],
        git: { available: status.ok, changed },
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

server.listen(PORT, '127.0.0.1', () => {
  const url = `http://localhost:${PORT}`;
  console.log(`\n  Photo studio  ${url}\n`);
  console.log(`  Library  ${path.relative(ROOT, LIBRARY)}`);
  console.log(`  Inbox    ${path.relative(ROOT, INBOX)}`);
  console.log('\n  Ctrl+C to stop.\n');

  // Best effort. If it fails the URL is printed above anyway.
  if (!process.argv.includes('--no-open')) {
    execFile('cmd', ['/c', 'start', '', url], () => {});
  }
});
