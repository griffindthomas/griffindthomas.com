---
title: Modular 3D-Printed UAV
summary: A 59-inch MQ-9-style airframe printed in sections, so a broken part costs one reprint instead of a new aircraft
status: In build
period: "2026"
order: 1
specs:
  - label: Wingspan
    value: 59 in / 1500 mm
  - label: Structure
    value: Printed modular sections
  - label: Tail boom
    value: Carbon fibre tube
  - label: CAD
    value: Fusion 360
  - label: Printer
    value: Bambu Lab A1
stack:
  - Fusion 360
  - FDM printing
  - Carbon composite
  - RC flight controllers
---

The airframe is printed in sections that bolt together rather than as a few
large parts. That was the whole point of the design. Anything that breaks on
landing is one part to reprint overnight, not a week of printing to replace an
aircraft.

It has been through several wing revisions. The first ones flew nose-heavy,
which showed up as a need for constant back pressure and a very short glide
after cutting power. Moving the battery aft and reworking the spar position
fixed most of it.

The tail boom is a carbon tube rather than printed, because printed booms
either flex under tail loads or get heavy enough to ruin the balance that the
wing revisions were meant to fix.
