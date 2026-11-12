# Reference-data sources

| Tag | Source |
|---|---|
| S26 | SKUAST-K, *Integrated Management Guide for Apple Orchards in Kashmir 2026*, No. AU/DEx/449-BL/01/26, via Directorate of Horticulture Kashmir. Official: https://hortikashmir.jk.gov.in/Data/SpraySchedule/SpraySchedule-2026-Urdu-English.pdf (mirror read: https://temperatefarming.com/wp-content/uploads/2026/02/Apple-Spray-Schedule-2026.pdf) |
| S25 | SKUAST-K schedule 2025, No. AU/DE/386BL/01/2025 |
| EXT | SKUAST-K monthly extension advisories 2026 (March, June, August) — skuastkashmir.ac.in |
| CIB | CIBRC *Major Uses of Pesticides* (apple rows), https://ppqs.gov.in/en/divisions/cib-rc/major-uses-of-pesticides |
| SO4294 | Insecticides (Prohibition) Order 2023, S.O. 4294(E), gazetted 3 Oct 2023 |

## Rules derived for the app
- 2026 schedule has **15 stages** (plan said 13): Delayed Dormancy → Dormancy. Data model is stage-count agnostic.
- Doses are per 100 L water exactly as printed in S26. Where the CIBRC label dose differs, the chemical record carries `statusNote` flag "dose differs from label" for agronomist review.
- PHI stored per product = **max(SKUAST table, CIBRC label)**; CIBRC is the legal reference.
- De-facto stop: all insecticides & fungicides 3–4 weeks before harvest (S26 general instruction 8). App: block < 21 d, warn < 28 d.
- General instructions encoded as validations: no fungicide+insecticide in one tank; 3–4 day gap between insecticide and fungicide sprays; never the same pesticide in consecutive sprays; no spray at full bloom.
- Calendar windows per stage are **inferred** (schedule gives only relative timing) for a 1,600–1,900 m valley orchard; they are shifted by elevation in the app.
- Schedule version status ships as `under_review`: the official Urdu/English PDF must be checked line-by-line by an agronomist before `published`.

## Open discrepancies for agronomist review
- Pink-bud "Zineb 68% + Hexaconazole 5%" — product registered as 68% + 4% (Avtar 72 WP).
- Propineb PHI 29–30 d conflicts with pre-harvest spray "15–20 days before harvest".
- SKUAST dose ≠ CIBRC label dose: Etoxazole, Zineb+Hexaconazole, Tebuconazole 38.9 SC, Chlorothalonil+Difenoconazole, Trifloxystrobin+Difenoconazole+Sulphur, Difenoconazole 25 EC, Myclobutanil, Dodine 65 WP, Spiromesifen.
- Paraquat ban (S.O. 5234(E), Sep 2026) and carbosulfan draft ban — reported, unverified.
