# Third-party notices

PLAYING GOD is licensed under GPL-3.0-only (see `LICENSE`). This file lists the direct third-party dependencies and the license each declares in its installed package metadata (checked 2026-10-23 against the local `.venv` and `frontend/node_modules`). Full license texts ship with each package; preserve them (and this file) when redistributing. This is a project record, not legal advice.

## Physics engine (the reason for the project license)
| Package | Version | License | Where used |
|---|---|---|---|
| [REBOUND](https://github.com/hannorein/rebound) (Hanno Rein et al.) | 5.2.2 | GPL-3.0-only | M0 spike only: `backend/experiments/`, `tests/spike/` (`backend/experiments/requirements.txt`). Not yet in `backend/requirements.txt`. |

## Backend (Python)
| Package | Version checked | License |
|---|---|---|
| FastAPI | 0.161.1 | MIT |
| Starlette (via FastAPI) | 1.9.0 | BSD-3-Clause |
| Pydantic / pydantic-core | 2.14.1 / 2.50.1 | MIT |
| Uvicorn | 0.54.0 | BSD-3-Clause |
| httpx | 0.28.1 | BSD-3-Clause |
| pytest | 9.1.1 | MIT |

## Frontend (JavaScript)
| Package | Version checked | License |
|---|---|---|
| React, React DOM | 18.3.1 | MIT |
| Vite | 5.4.21 | MIT |
| @vitejs/plugin-react | 4.7.0 | MIT |
| TypeScript | 5.9.3 | Apache-2.0 |
| Three.js | not yet installed | MIT (verify when added) |

## Transitive dependencies
The other Python packages in the `.venv` declare MIT, BSD, Apache-2.0, PSF-2.0 or MPL-2.0 (`certifi`, MPL-2.0, file-level copyleft, no conflict with GPL-3.0). All are generally considered GPL-3.0-compatible. Re-run the check when dependencies change (`importlib.metadata` for Python, `package.json` `license` fields for npm) and update this file; add Three.js and any other new dependency before release.

## Data (committed, offline)
| Data | Source | Terms / note |
|---|---|---|
| Solar System state vectors (`backend/presets/sources/horizons/`) | NASA/JPL Horizons System API, retrieved 2026-10-24 | JPL/NASA data, publicly available; attribution kept in `context/PRESETS.md` and in each data file |
| GM values, au, G (`backend/presets/data/solar-system-j2000.json`) | JPL SSD Astrodynamic Parameters; Park et al. 2021, AJ 161:105 (DE440/DE441) | cited, transcribed |
| Planet and Moon mean radii | JPL SSD Planetary / Planetary Satellite Physical Parameters (Archinal et al. 2018) | cited, transcribed |
| Sun nominal radius and GM | IAU 2015 Resolution B3 (Mamajek et al., arXiv:1510.07674) | cited, transcribed |
