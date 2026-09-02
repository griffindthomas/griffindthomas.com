---
title: ADS-B Ground Station
summary: A Raspberry Pi and an RTL-SDR decoding 1090 MHz transponder traffic over Puget Sound
status: Running
period: "2026"
order: 3
specs:
  - label: Receiver
    value: RTL-SDR Blog V3
  - label: Host
    value: Raspberry Pi
  - label: Frequency
    value: 1090 MHz
  - label: Feeds
    value: FlightRadar24
  - label: Radar code
    value: T-KBFI187
  - label: Site
    value: West Seattle
stack:
  - Raspberry Pi
  - RTL-SDR
  - dump1090
  - Linux
draft: false
---

Aircraft broadcast their position, altitude and callsign in the clear on
1090 MHz. A cheap software-defined radio and a Pi are enough to decode it, so
the station listens to everything moving over Puget Sound and feeds
FlightRadar24 as `T-KBFI187`.

Its range is worse than it should be. The antenna is the next thing to fix:
1090 MHz is line of sight, so height and cable loss decide almost everything,
and the current setup is compromised on both.

The long-term plan for this site is to put that feed on the front page rather
than proxying somebody else's. Feeding a radar from an antenna I can see out
the window is a better story than borrowing an API.
