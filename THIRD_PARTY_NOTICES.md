# Third-party software

Downloaded at setup time into `vendor/` (not distributed in this repository), used unmodified as a separate process:

| Component | Version | Licence | Source |
|---|---|---|---|
| MPXJ (and its bundled dependencies: Apache POI, Jackson, jsoup, sqlite-jdbc, Jackcess, RTF Parser Kit, Apache Commons, JAXB) | 16.10.0 | LGPL-2.1 (MPXJ); Apache-2.0 / MIT / BSD for dependencies | https://www.mpxj.org — https://github.com/joniles/mpxj |
| Eclipse Temurin JRE | 21.0.13+9 | GPLv2 with Classpath Exception | https://adoptium.net |

Bundled in the built app:

| Component | Licence |
|---|---|
| React, React DOM | MIT |
| zustand | MIT |
| fast-xml-parser | MIT |
| Tailwind CSS | MIT |
| IBM Plex Sans (via @fontsource) | SIL Open Font License 1.1 |

Test fixtures fetched by `npm run fixtures` come from the MPXJ project's public test corpus (LGPL-2.1) and are not committed.

Reference studied (concepts only, no code used): TMailletFR/ProjectEngine (GPL-3.0).
