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

The blower motor died at the start of the summer. No air out of any vent at
any speed, with a drive from Seattle to New Hampshire booked for the end of
August. If it was not fixed by then the trip happened in a different car, so
there was a date on it.

I started with the blower motor itself. A replacement off Amazon went in and
changed nothing.

The dealership diagnosed the Junction Box Unit and quoted $2,500 to replace
it. I took the dash apart myself, pulled the JBU, wrote down the part number
and then spent hours on eBay finding another one, because it was a short
production run and they are scarce. It came, I fitted it, the blower stayed
dead.

A replacement JBU has to be flashed to match the modules already in the car.
The only software that does the procedure is entirely in German, so I learned
enough German to work through the interface.

The first flash failed and bricked the car. The dash came up with the red car
symbol, which usually means the electronics are not coming back. I tried again
and bricked it a second time.

I found a German developer on a forum and emailed him. He worked out that the
car was not holding enough supply voltage through the flash, which is exactly
the way a module ends up half written and dead. On a proper external supply
the reflash went through and the JBU coded correctly.

The blower was still dead.

The part that had failed was the climate control module. It plugs in. I
swapped it and the air came on immediately. Nobody at the dealership had
mentioned it.

That was four or five hours a day after practice, most of a summer, while I
was swimming for two teams. It was done a few days before we left. The
dealership got the module wrong, and I kept going down the same path for
weeks after they did.

## The raccoon weekend

I hit a raccoon and it took out the A/C condenser, so the front of the car had
to come apart anyway. I used that as the excuse to do everything else at once.

The front clip and the cooling stack came off for the condenser. A cracked
upper radiator hose came out with it, and the two-piece radiator drain
petcock got rebuilt and reseated before the electronic coolant bleed. Then
full synthetic oil, a serpentine belt, and the hydraulic lifter tick the N52
is known for. On the intake side, a charcoal filter delete and a resonator
delete I cut, sanded and sealed with RTV.

Parts came to about $300, plus paying a shop to vacuum test the A/C, which is
the only part of it I did not do myself. The same list at the dealership is
north of $1,200 in labour before any markup on parts.

Two things did not go to plan. I did not own a T60 Torx for the belt
tensioner, so I worked out how the tensioner spring released and did the job
without one. And I rounded a block bolt on the oil filter housing gasket and
stopped there, because a snapped bolt in the block is a whole different
weekend and an extractor in an aluminium block is worse. That gasket is still
on the list.
