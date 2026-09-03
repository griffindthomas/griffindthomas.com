---
title: griffindthomas.com
summary: This site. Static Astro on Cloudflare's edge, with a photo pipeline built so that adding a frame is not a code change
status: Live
period: "2026"
order: 5
specs:
  - label: Framework
    value: Astro, static output
  - label: Host
    value: Cloudflare Workers
  - label: Deploy
    value: Push to main, 50 sec
  - label: Photo record
    value: JSON beside the JPEG
  - label: Editor
    value: Local, 127.0.0.1
  - label: Source
    value: Public on GitHub
stack:
  - Astro
  - TypeScript
  - Tailwind
  - Cloudflare Workers
  - sharp
  - exifr
draft: false
---

Every page is built to a static file and served from Cloudflare's edge. No
database, and nothing on the internet that can be logged into.

## Written with Claude

Claude Code did the typing, and the commit history is public anyway. I decide
what it does, what it looks like and what it says, which often means telling it
the thing it just built is wrong: the split-flap took three attempts, the
aircraft silhouettes four. The photographs are mine, every registration read
off the airframe, and the swim times are the officially timed ones.

## The photo pipeline

A frame goes in an inbox folder and one command imports it.

- EXIF off the file, so body, lens, focal length, shutter and ISO are not from
  memory
- A resize, and a tiny blurred copy inlined so the grid never flashes empty
- A JSON record written beside the photo
- Airfield codes checked against a real list, so a typo fails the build

What it will not do is guess. Type, registration, operator and airfield are
typed by hand, and anything I cannot read off the airframe stays empty. There
is a P-8A in the gallery whose last serial digit is illegible and it stays
blank until I shoot that aircraft again. Nothing hand-entered is ever
overwritten by a later import, because an importer that clobbers a correction
is one you stop running.

## What does not work

The live radar. All three community ADS-B feeds refuse requests from
Cloudflare's network while the identical request from my laptop returns fine,
and there is nothing to cache when there is no successful response. The
endpoint reports itself unavailable rather than inventing aircraft. The fix is
my own receiver, and there is a Pi and an RTL-SDR in West Seattle already
feeding. It waits until I am back there.
