---
title: BMW E90 A/C Troubleshooting
summary: A dead blower motor, a $2,500 dealer quote, two bricked cars, and the $100 part that turned out to be the fault
status: Fixed
period: "2024"
order: 4
specs:
  - label: Car
    value: E90 3-series, N52
  - label: Symptom
    value: No air, any speed
  - label: Dealer quote
    value: $2,500
  - label: Actual fault
    value: Climate control module
  - label: Cars bricked
    value: "2"
  - label: Deadline
    value: Seattle to New Hampshire
stack:
  - Automotive electrical diagnosis
  - Module coding
  - Firmware flashing
  - Dash teardown
  - Parts sourcing
draft: false
---

No air, any vent, any speed, with a drive from Seattle to New Hampshire booked
for the end of August.

## In order

1. New blower motor. No change.
2. Dealer diagnosed the Junction Box Unit at $2,500. I pulled the dash and the
   JBU myself, found a used one on eBay, fitted it. No change.
3. A replacement JBU has to be flashed to the modules already in the car, and
   the only software that runs the procedure is entirely in German. I learned
   enough German to work the interface.
4. The flash bricked the car. Red car symbol, which usually means the
   electronics are not coming back. Second attempt bricked it again.
5. A German developer on a forum found it: the car was not holding supply
   voltage through the flash, which is how a module ends up half written. On an
   external supply it took.
6. The blower was still dead. The fault was the climate control module, which
   plugs in. The air came on immediately.

Most of a summer, four or five hours a day after practice, while swimming for
two teams. The dealership never mentioned the module, and I kept going down
their path for weeks after they did.

## The raccoon weekend

I hit a raccoon, it took out the condenser, and the front of the car had to
come off anyway.

- Condenser, and a cracked upper radiator hose that came out with it
- Petcock rebuilt and reseated, then an electronic coolant bleed
- Full synthetic oil, serpentine belt, the lifter tick the N52 is known for
- Charcoal filter delete, and a resonator delete I cut, sanded and sealed

$300 in parts. The same list at a dealership is north of $1,200 in labour.

Two I did not finish. No T60 Torx for the belt tensioner, so I worked out how
the spring released and did it without one. And I rounded a block bolt on the
oil filter housing gasket and stopped, because an extractor in an aluminium
block is a worse weekend than the one it saves.
