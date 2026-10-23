# Port Call Simulator: Hutchison Ports ECT Delta, Rotterdam

Built by emilio.solanes. Personal project, not affiliated with or endorsed by the companies mentioned.

A 48 hour discrete event simulation of vessel calls at Hutchison Ports ECT Delta on Maasvlakte I, Rotterdam, seen from above. Every port call service in every call is exchanged as a DCSA Port Call 2.0 event with the Estimated, Requested, Planned, Actual (ERPA) pattern. Click any vessel, crane, AGV, tug, the pilot helicopter or the bunker barge for its live card. Tap any event for its `POST /events` payload.

Open `index.html` in any current browser. It is a single self-contained file with three.js inlined, so it runs offline; without internet the page falls back to system fonts. To share a link instead, enable GitHub Pages (Settings → Pages → Deploy from branch → `main`, root).

## What it shows

| Call | Vessel | Story |
|---|---|---|
| MSC Gülsün | MSC, Lion | In from Hamburg. Loads export boxes for Asia, takes bunkers alongside on the Amazonehaven and sails for Antwerp around noon on Tuesday. |
| MSC Irina | MSC, Britannia | In from Felixstowe, seven hours ahead of its berth window. The terminal requests 14:00, once MSC Gülsün has cleared the Amazonehaven, and the ship slows down instead of anchoring. Hit by a wind stop and a crane fault on Wednesday; every downstream estimate is revised. |
| Nordic Tern | Feeder (fictional) | Clears the feeder berth overnight. |
| Humber Gull | Feeder (fictional) | Master holds a pilotage exemption certificate: no PBP or pilotage service. |
| Baltic Wren | Feeder (fictional) | First estimate 5 h before arrival. Berth already planned, so 9+ h at anchor. |
| Kattegat Eider | Feeder (fictional) | Plans ahead, berths on time. |

## Port Call 2.0 mapping

Services: `PILOT_BOARDING_PLACE`, `ANCHORAGE`, `SEA_PASSAGE`, `PILOTAGE`, `TOWAGE`, `MOORING`, `BERTH`, `ALL_FAST`, `GANGWAY_DOWN_AND_SECURE`, `VESSEL_READY_FOR_CARGO_OPERATIONS`, `CARGO_OPERATIONS`, `DISCHARGE_CARGO_OPERATIONS`, `LOADING_CARGO_OPERATIONS`, `BUNKERING`, `SLUDGE`, `LASHING`, `VESSEL_READY_TO_SAIL`, `MOVES`.

Event types `ARRI`, `DEPA`, `STRT`, `CMPL`. Phases `INBD`, `ALGS`, `OUTB`. Classifiers `EST`, `REQ`, `PLN`, `ACT`. Senders and receivers follow the Port Call 2.0 use cases (for example ETA BERTH carrier to terminal, RTA BERTH terminal to carrier, ETS PILOTAGE pilotage provider to port authority). Negotiable services run E, R, P, then A. Informative services send A only.

Scope: one terminal. The rest of the port is not modelled, so there is no competition from other terminals' calls for pilots, tugs, linesmen or the fairway. For scale, the Port of Rotterdam handled 27,384 seagoing calls in 2025.

Not modelled: `SHORE_POWER`, `SAFETY`, `ANCHORAGE_OPERATIONS`, shifting (`SHIF`), cancel, omit and decline.

## How the model works

`src/sim.js` is a small event engine (priority queue, generator processes, resource pools for tugs, pilots and mooring crews). Each call is one process: approach, anchorage if early, pilot boarding (helicopter for deep draught, tender at Maascenter otherwise), tug rendezvous, in through the Maasmond and down the Beerkanaal, swing in the turning basin and astern into the Amazonehaven (feeders go straight to the Delta Barge Feeder Terminal), mooring, cargo operations crane by crane, bunkering and sludge, lashing, departure.

The engine runs once per disruption subset (none, wind, wind plus crane fault). The first run gives the plan, each later run gives the revised estimates sent shortly after that disruption starts, and the last run gives the actuals. That is how estimate revisions ripple through cargo completion, berth departure, pilotage, towage and mooring.

`src/app.js` renders the scene with three.js r128 and drives the panels. `src/geo-data.js` holds the map. `src/styles.css` holds the design tokens (light and dark).

## Build and test

```
node build.js            # index.html (three.js inlined from vendor/, works offline) and dist/artifact.html (three.js from CDN)
node test/sim.test.js    # sequence, berth, crane and vessel encounter checks
python3 tools/osm-prep.py  # regenerates src/geo-data.js from the OpenStreetMap extracts in data/
```

Edit the files in `src/`, then rebuild. `index.html` is generated, so edits made directly in it are lost on the next build. `vendor/` holds three.js r128 and its OrbitControls under the MIT License (`vendor/LICENSE-three.txt`).

## Terminal and layout

ECT Delta as Hutchison Ports publishes it: 272 ha and 4.0 km of quay on the Europahaven and Amazonehaven, 16.65 m water depth, separate feeder and barge facilities and two rail terminals. Hutchison Ports took delivery of 5 remote-operated mega-ship cranes in 2014, 3 in 2015 and 3 more for the Amazonehaven in 2025; the model puts all 11 on the ULCS quay on the Amazonehaven. Feeders berth at the Delta Barge Feeder Terminal on the Beerkanaal, with 3 cranes assumed. The western end of the Amazonehaven quay is drawn with idle cranes and not modelled.

The map is drawn from OpenStreetMap: coastline, harbour basins, breakwaters, terminal outlines and the rails of the stacking crane blocks, which place the 105 ASC blocks behind the quay. The view is rotated so the Amazonehaven quay runs across the screen, and offshore distances along the Maasgeul and Eurogeul are compressed. Inbound and outbound traffic keep to their own side of the fairway.

## Assumptions

Vessel particulars of MSC Gülsün and MSC Irina are public, and Lion and Britannia are MSC services that call Rotterdam. Which terminal and berth they use, their schedules, voyages, moves and timestamps are simulated. The four feeders are fictional. Cranes run at 23 gross moves per hour with 6 AGVs each. ATA berth is first line ashore; all fast follows when mooring completes.

Sources: [DCSA Port Call 2.0 use cases](https://reference.dcsa.org/content/standards/releases/port-call/v2-0-0/port-call-v2-0-0-use-cases), [Port Call 2.0 API](https://app.swaggerhub.com/apis/dcsaorg/DCSA_PORT_CALL/2.0.0), [Hutchison Ports ECT Delta](https://www.ect.nl/en/terminals/hutchison-ports-ect-delta), [ECT Delta cranes 2014 and 2015](https://www.marinelink.com/news/terminal-receives393089), [ECT Delta cranes 2025](https://myterminal.ect.nl/news/three-new-quay-cranes-ect-delta-terminal), [MSC at ECT Delta](https://binnenvaartkrant.nl/hutchison-helpt-msc-aan-eigen-terminal-in-rotterdam), [MSC Lion and Britannia rotations](https://www.msc.com/en/newsroom/customer-advisories/2025/october/port-rotation-changes-trade-far-east-nwc), [MSC Gülsün](https://en.wikipedia.org/wiki/G%C3%BCls%C3%BCn-class_container_ship), [MSC Irina](https://www.themeditelegraph.com/en/shipping/shipowners/2023/03/14/news/msc_shatters_records_with_delivery_of_24346_teu_msc_irina-12693791/), [Maascenter](https://en.wikipedia.org/wiki/Maascenter), [Rotterdam calls in 2025](https://ship.energy/policy/ports/port-of-rotterdam-records-dip-in-seagoing-vessel-calls-in-2025/).

## License

Code: MIT, see `LICENSE`. three.js in `vendor/` is MIT licensed by the three.js authors.

Map data: © OpenStreetMap contributors, available under the [Open Database License](https://www.openstreetmap.org/copyright). The extracts in `data/` and the derived `src/geo-data.js` are under the ODbL.
