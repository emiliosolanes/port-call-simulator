# Port Call Simulator: Rotterdam (ECT Delta) to Antwerp (MPET)

Built by emilio.solanes. Personal project, not affiliated with or endorsed by the companies mentioned.

A 48 hour discrete event simulation of vessel calls at Hutchison Ports ECT Delta on Maasvlakte I, Rotterdam, and of the next call of MSC Gülsün at MSC PSA European Terminal (MPET) on the Deurganckdok, Antwerp, seen from above. Every port call service in every call is exchanged as a DCSA Port Call 2.0 event with the Estimated, Requested, Planned, Actual (ERPA) pattern. Click any vessel, crane, AGV, straddle carrier, tug, pilot boat, the pilot helicopter or the bunker barge for its live card. Tap any event for its `POST /events` payload.

Switch between Rotterdam and Antwerp at the top left. From Antwerp you watch the next port call being orchestrated while the ship is still alongside in Rotterdam: the estimates arrive, the terminal requests, the plan follows, and every change in Rotterdam comes through as revised events.

Open `index.html` in any current browser. It is a single self-contained file with three.js inlined, so it runs offline; without internet the page falls back to system fonts. To share a link instead, enable GitHub Pages (Settings → Pages → Deploy from branch → `main`, root).

## What it shows

| Call | Vessel | Story |
|---|---|---|
| MSC Gülsün | MSC, Lion | In from Hamburg. Loads export boxes for Asia and takes bunkers alongside on the Amazonehaven. A hoist fault on crane Q03 makes it sail for Antwerp an hour late, on Tuesday around noon. |
| MSC Gülsün, Antwerp | MSC, Lion | Next port. Planned on the Rotterdam schedule to berth at MPET on Tuesday evening. At 15.3 m draught it needs the inbound tidal window in the Scheldt; the hour lost in Rotterdam misses it, so the carrier re-plans, the ship slows down for the next window and berths about 10 hours later. |
| MSC Irina | MSC, Britannia | In from Felixstowe, seven hours ahead of its berth window. The terminal requests 14:00, once MSC Gülsün has cleared the Amazonehaven, and the ship slows down instead of anchoring. Hit by a wind stop and a crane fault on Wednesday; every downstream estimate is revised. |
| Nordic Tern | Feeder (fictional) | Clears the feeder berth overnight. |
| Humber Gull | Feeder (fictional) | Master holds a pilotage exemption certificate: no PBP or pilotage service. |
| Baltic Wren | Feeder (fictional) | First estimate 5 h before arrival. Berth already planned, so 9+ h at anchor. |
| Kattegat Eider | Feeder (fictional) | Plans ahead, berths on time. |

## Port Call 2.0 mapping

Services: `PILOT_BOARDING_PLACE`, `ANCHORAGE`, `SEA_PASSAGE`, `PILOTAGE`, `TOWAGE`, `MOORING`, `BERTH`, `ALL_FAST`, `GANGWAY_DOWN_AND_SECURE`, `VESSEL_READY_FOR_CARGO_OPERATIONS`, `CARGO_OPERATIONS`, `DISCHARGE_CARGO_OPERATIONS`, `LOADING_CARGO_OPERATIONS`, `BUNKERING`, `SLUDGE`, `LASHING`, `VESSEL_READY_TO_SAIL`, `MOVES`.

Event types `ARRI`, `DEPA`, `STRT`, `CMPL`. Phases `INBD`, `ALGS`, `OUTB`. Classifiers `EST`, `REQ`, `PLN`, `ACT`. Senders and receivers follow the Port Call 2.0 use cases (for example ETA BERTH carrier to terminal, RTA BERTH terminal to carrier, ETS PILOTAGE pilotage provider to port authority). Negotiable services run E, R, P, then A. Informative services send A only. Each port has its own parties: in Antwerp the terminal is MPET, with the Port of Antwerp-Bruges harbour master, the Flemish pilots, towage and Brabo linesmen.

Scope: one terminal per port. The rest of each port is not modelled, so there is no competition from other terminals' calls for pilots, tugs, linesmen or the fairway. For scale, the Port of Rotterdam handled 27,384 seagoing calls in 2025.

Not modelled: `SHORE_POWER`, `SAFETY`, `ANCHORAGE_OPERATIONS`, shifting (`SHIF`), cancel, omit and decline.

## How the model works

`src/sim.js` is a small event engine (priority queue, generator processes, resource pools for tugs, pilots and mooring crews per port, and signals between processes). Each call is one process: approach, anchorage if early, pilot boarding (helicopter for deep draught, tender at Maascenter otherwise; at Antwerp a pilot boat at the Wandelaar and a pilot change off Vlissingen), tug rendezvous, into the basin (Rotterdam: through the Maasmond, down the Beerkanaal, swing in the turning basin and astern into the Amazonehaven; Antwerp: up the Westerschelde and the Scheldt, swing in front of the Deurganckdok and astern to the MPET quay), mooring, cargo operations crane by crane, bunkering and sludge, lashing, departure.

The next-port call waits for a signal: the moment the pilot leaves MSC Gülsün off Rotterdam. Then it adds the sea passage and, for a deep draught, the next inbound tidal window at Vlissingen.

The engine runs once per disruption subset (none, Q03 fault, plus wind, plus Q09 fault). The first run gives the plan, each later run gives the revised estimates sent shortly after that disruption starts (at a next port, a little later, once the carrier has re-planned), and the last run gives the actuals. A message first sent after a disruption already carries the revised value. That is how estimate revisions ripple through cargo completion, berth departure, pilotage, towage and mooring, and on to the next port.

`src/app.js` renders the scene with three.js r128 and drives the panels. `src/geo-data.js` holds the Rotterdam map, `src/geo-anr-data.js` the Antwerp map and `src/geo-anr-spec.js` the Antwerp layout the simulation uses. `src/styles.css` holds the design tokens (light and dark).

## Build and test

```
node build.js                  # index.html (three.js inlined from vendor/, works offline) and dist/artifact.html (three.js from CDN)
node test/sim.test.js          # sequence, berth, crane, vessel encounter, stale estimate, tide window and on-the-water checks
python3 tools/osm-prep.py      # regenerates src/geo-data.js from the Rotterdam extracts in data/
python3 tools/osm-prep-anr.py  # regenerates src/geo-anr-spec.js and src/geo-anr-data.js from data/osm-anr.json (needs shapely)
```

Edit the files in `src/`, then rebuild. `index.html` is generated, so edits made directly in it are lost on the next build. `vendor/` holds three.js r128 and its OrbitControls under the MIT License (`vendor/LICENSE-three.txt`).

## Terminals and layout

ECT Delta as Hutchison Ports publishes it: 272 ha and 4.0 km of quay on the Europahaven and Amazonehaven, 16.65 m water depth, separate feeder and barge facilities and two rail terminals. Hutchison Ports took delivery of 5 remote-operated mega-ship cranes in 2014, 3 in 2015 and 3 more for the Amazonehaven in 2025; the model puts all 11 on the ULCS quay on the Amazonehaven. Feeders berth at the Delta Barge Feeder Terminal on the Beerkanaal, with 3 cranes assumed. The western end of the Amazonehaven quay is drawn with idle cranes and not modelled.

MPET as PSA publishes it: 3,700 m of quay, 38 quay cranes, 247 ha, 17 m water depth, a joint venture of PSA and Terminal Investment Limited (TIL). The model draws 24 cranes on the west quay of the Deurganckdok and works 6 of them on MSC Gülsün at 25 gross moves per hour, with 4 straddle carriers per crane (an assumption). Antwerp Gateway, across the dock, is drawn with idle cranes and not modelled.

Both maps come from OpenStreetMap. Rotterdam: coastline, harbour basins, breakwaters, terminal outlines and the rails of the stacking crane blocks, which place the 105 ASC blocks behind the quay; offshore distances along the Maasgeul and Eurogeul are compressed. Antwerp: the Scheldt, the docks of the Waasland and the right bank, the MPET and Antwerp Gateway outlines and storage tanks; the Westerschelde and the North Sea coast are drawn schematically from reference positions, at real distances (Wandelaar to the Deurganckdok is about 100 km). Each view is rotated so the main quay runs across the screen. Inbound and outbound traffic keep to their own side of the fairway.

The Scheldt tide is simplified: high water every 12 h 25 min, and an inbound window at Vlissingen from 2.5 h before to 30 min after high water for ships deeper than 14.5 m. Tug and boatmen standby places in Antwerp are schematic.

## Assumptions

Vessel particulars of MSC Gülsün and MSC Irina are public, and Lion and Britannia are MSC services that call Rotterdam. Which terminals and berths they use, the Rotterdam to Antwerp leg, their schedules, voyages, moves and timestamps are simulated. The four feeders are fictional. Cranes run at 23 gross moves per hour with 6 AGVs each in Rotterdam, 25 with 4 straddle carriers each in Antwerp. ATA berth is first line ashore; all fast follows when mooring completes.

Sources: [DCSA Port Call 2.0 use cases](https://reference.dcsa.org/content/standards/releases/port-call/v2-0-0/port-call-v2-0-0-use-cases), [Port Call 2.0 API](https://app.swaggerhub.com/apis/dcsaorg/DCSA_PORT_CALL/2.0.0), [Hutchison Ports ECT Delta](https://www.ect.nl/en/terminals/hutchison-ports-ect-delta), [ECT Delta cranes 2014 and 2015](https://www.marinelink.com/news/terminal-receives393089), [ECT Delta cranes 2025](https://myterminal.ect.nl/news/three-new-quay-cranes-ect-delta-terminal), [MSC at ECT Delta](https://binnenvaartkrant.nl/hutchison-helpt-msc-aan-eigen-terminal-in-rotterdam), [MSC Lion and Britannia rotations](https://www.msc.com/en/newsroom/customer-advisories/2025/october/port-rotation-changes-trade-far-east-nwc), [MSC Gülsün](https://en.wikipedia.org/wiki/G%C3%BCls%C3%BCn-class_container_ship), [MSC Irina](https://www.themeditelegraph.com/en/shipping/shipowners/2023/03/14/news/msc_shatters_records_with_delivery_of_24346_teu_msc_irina-12693791/), [Maascenter](https://en.wikipedia.org/wiki/Maascenter), [Rotterdam calls in 2025](https://ship.energy/policy/ports/port-of-rotterdam-records-dip-in-seagoing-vessel-calls-in-2025/), [MPET](https://www.psa-antwerp.be/en/terminals/msc-psa-european-terminal-mpet), [Wandelaar pilot station](https://www.agentschapmdk.be/en/required-boarding-arrangements-at-wandelaar-pilot-station).

## License

Code: MIT, see `LICENSE`. three.js in `vendor/` is MIT licensed by the three.js authors.

Map data: © OpenStreetMap contributors, available under the [Open Database License](https://www.openstreetmap.org/copyright). The extracts in `data/` and the derived `src/geo-data.js`, `src/geo-anr-data.js` and `src/geo-anr-spec.js` are under the ODbL.
