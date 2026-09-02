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
---

Every page here is built into a static file and served from Cloudflare's edge.
A push to the main branch is live in about fifty seconds. There is no database
and nothing on the internet that can be logged into.

## The photo pipeline

A new frame goes into an inbox folder and one command imports it. The importer
reads the EXIF the camera wrote, so the body, the lens, the focal length, the
shutter speed and the ISO under every photo come off the file rather than out
of my memory. It resizes the image, builds a tiny blurred copy that is inlined
into the page so the grid never flashes empty boxes while it loads, and writes
a JSON record next to the photo with everything it found.

What it will not do is guess. Type, registration, operator and airfield are
typed in by hand, and any field I cannot read off the airframe stays empty.
There is a P-8A in the gallery whose last serial digit is illegible, and it is
going to stay blank until I shoot that aircraft again.

Nothing hand-entered is ever overwritten by a later import. That is the rule
the whole pipeline is built around, because an importer that clobbers a
correction is one you stop running.

Editing happens on my own machine rather than on the site: one command opens a
small editor on 127.0.0.1 where I can drop photos in, fix a field, and publish,
which commits and pushes. Airfield codes are validated against a real list at
build time, so a typo fails the build instead of quietly creating a gallery
filter with one photo behind it.

## The split-flap modules

The aircraft names on the home page and the board on the spotting page are
built out of real photo records, not decorative text. The characters are
rendered into the page on the server, so with JavaScript switched off it is
plain text in boxes. The flipping is added afterwards and is never the thing
that puts the words there.

The favicon is the griffin traced into vector paths, which is what lets it
switch to a light mark when the browser is in dark mode. The version before it
wrapped a PNG inside an SVG, which renders perfectly as an image and not at
all as a tab icon, so the tab came up blank.

## What does not work

The live radar. The plan was to show traffic overhead at Sky Harbor and Boeing
Field from the community ADS-B feeds, and all three of them refuse requests
that come from Cloudflare's network, with 403s and 429s, while the identical
request from my laptop returns fine. There is nothing to cache when there is
no successful response to cache, and a fourth provider of the same kind will
behave the same way. The endpoint reports itself unavailable rather than
inventing aircraft.

The way out is my own receiver. There is a Raspberry Pi and an RTL-SDR in West
Seattle already feeding, and pointing this site at that instead of at a public
feed is the fix. It waits until I am back there with access to the box.
