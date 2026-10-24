# UI-0 Branch Report — Celestial Asset and Rendering Foundation

**Branch:** `ui-0`
**Purpose:** Team lead verification before integration
**Status:** UI-0 implementation is ready for integration. The full backend metadata branch is not yet merged into the running API.

## What is implemented

- A reusable asset registry maps only the backend-provided `assetKey` to body-specific maps. It does not infer visual identity from body names, IDs, or catalogue IDs.
- Generic maps are selected by `bodyType`; missing or unknown asset keys fall back to those maps. Missing or unknown body types resolve to the `default` rendering path and preserve the backend body color.
- API parsing remains compatible with older responses: missing/unknown `bodyType` becomes `default`; missing or null `assetKey` means no body-specific map. The view model carries the safe metadata to the canvas.
- Reusable Three.js materials load diffuse, normal, roughness, and emissive maps when available. Shared texture URLs are reference-counted and disposed after their final consumer releases them. Failed texture loads leave the body visible using generic maps or its backend color.
- Atmosphere and ring rendering are opt-in map/metadata behavior. No planet effects or identity are inferred from a body's name. The current 36-file asset manifest contains no ring maps.
- A visual test scene covers representative body classes, lighting, selection, framing, and fallback rendering.
- A standalone `frontend/visual-test.html` page opens that fixture in-browser without replacing the regular app entry point.
- The texture generator and attribution record reproduce the exact 36-file manifest from nine source maps.

## Asset inventory and provenance

Body-specific candidate sets: Sun, Earth, Mars, Jupiter, Neptune, Proxima Centauri, TRAPPIST-1, Sirius A, and Betelgeuse. These are rendering candidates, not a finalized preset catalogue. Generic fallback sets cover stars, rocky planets, gas giants, ice giants, and asteroids.

Planet and solar source maps are from [Solar System Scope (INOVE)](https://www.solarsystemscope.com/textures/) under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Attribution and per-output modifications are recorded in `frontend/public/assets/textures/ATTRIBUTION.md`. Generated normal and roughness maps are luminance-based visual approximations, not measured physical data. The non-Solar star maps are illustrative tints derived from the Sun map, not observed star imagery.

## Main files for review

- `frontend/src/assets/registry.ts` — asset-key lookup and generic fallbacks.
- `frontend/src/components/canvas/CelestialMaterial.tsx` — asynchronous shared texture loading, material setup, fallback, and cleanup.
- `frontend/src/components/canvas/CelestialBody.tsx` and `frontend/src/components/canvas/UniverseCanvas.tsx` — body metadata/material wiring and opt-in visual effects.
- `frontend/src/components/canvas/CelestialVisualTestScene.tsx` — visual fixture scene.
- `frontend/visual-test.html` and `frontend/src/visual-test.tsx` — standalone interactive browser fixture; click to change selection, drag to orbit, scroll to zoom.
- `frontend/src/api/types.ts`, `frontend/src/api/parse.ts`, and `frontend/src/sim/viewModel.ts` — backward-compatible metadata propagation.
- `frontend/public/assets/textures/` — 36 generated texture maps and attribution.
- `scripts/build_ui0_textures.py`, `scripts/requirements-ui0-textures.txt` — reproducible texture generation.
- Tests: `frontend/src/assets/registry.test.ts`, `frontend/src/components/canvas/CelestialMaterial.test.tsx`, and updated parser/view-model tests.

## Verification for this review

Commands run and results:

- Focused parser/material/registry/view-model run: `/Users/nikhiljha/.nvm/versions/node/v24.22.1/bin/node node_modules/vitest/vitest.mjs run src/api/parse.test.ts src/components/canvas/CelestialMaterial.test.tsx src/assets/registry.test.ts src/sim/viewModel.test.ts` from `frontend/` — **35 tests passed** across 4 files. This covers absent metadata (legacy response), current `bodyType`-only API shape, null metadata, unknown `bodyType`, unknown `assetKey`, load failures, unmount cleanup, and shared texture loading.
- Full frontend suite: `/Users/nikhiljha/.nvm/versions/node/v24.22.1/bin/node node_modules/vitest/vitest.mjs run` from `frontend/` — **214 passed, 1 failed** across 25 files. The failure is `src/App.test.tsx > App view aids > shows the grid while placing a body...`: the mixed `App.tsx` diff no longer passes `gridShownForPlacement` to `ViewPanel`, so its expected placement note is absent.
- `/Users/nikhiljha/.nvm/versions/node/v24.22.1/bin/node node_modules/typescript/bin/tsc --noEmit` from `frontend/` — **one remaining error**, the same missing `gridShownForPlacement` prop in `App.tsx`. The gallery's `BodyType` type import was corrected during this review; no other errors remain.
- Started Vite with `/Users/nikhiljha/.nvm/versions/node/v24.22.1/bin/node node_modules/vite/bin/vite.js --host 127.0.0.1` (port 5173 was already occupied, so Vite used 5174); opened `http://127.0.0.1:5174/visual-test.html` in a real browser with WebGL. Observed textured Sun, Earth, Jupiter, Neptune, generic asteroid, purple color-only default fallback, centered initial framing, a visible selection outline, and selection changing to Jupiter after clicking it. The fixture uses OrbitControls for orbit/zoom.
- `PYTHONPATH=/private/tmp/playing-god-ui0-python /opt/homebrew/bin/python3.11 scripts/build_ui0_textures.py --raw-dir /private/tmp/playing-god-ui0-raw --out-dir /private/tmp/ui0-textures-rebuild-a` and the same command with `--out-dir /private/tmp/ui0-textures-rebuild-b`; `diff -qr /private/tmp/ui0-textures-rebuild-a /private/tmp/ui0-textures-rebuild-b` — **identical**. `diff -qr --exclude=ATTRIBUTION.md /private/tmp/ui0-textures-rebuild-a frontend/public/assets/textures` — generated JPGs are **byte-identical** to current worktree outputs (the repository folder additionally has the attribution file).
- Pillow validation — **36 JPEGs**, each 2048×1024.
- `git diff --check` — passed after the current changes.

The production build emitted a Vite warning that the minified JavaScript chunk exceeds the suggested 500 kB threshold. Bundle splitting/performance follow-up belongs to UI-6 unless it is shown to block this integration.

Attribution was checked against the [official Solar System Scope texture page](https://www.solarsystemscope.com/textures/), which identifies the maps and CC BY 4.0 license. The local record includes attribution, transformations, and caveats for generated/illustrative maps.

## Integration dependencies and review notes

- The agreed backend fields are `bodyType` and nullable `assetKey`, returned on state, step, reset, create, and update responses, including universe-scoped routes. Until the backend branch is merged/deployed, missing fields intentionally render through the generic/default fallback.
- Please verify API propagation for those response routes and ensure merged-body metadata follows backend-defined behavior; the frontend makes no assumption about a merged body's texture.
- `backend/models.py` has a one-line uncommitted response-model change adding `bodyType: str = "default"`. Its purpose appears to be backend metadata compatibility, likely owned by the backend implementer/Teammate 2. It does not add `assetKey` and does not implement the full finalized contract. The local diff itself does not record its author, so ownership is an inference.
- `frontend/src/App.tsx` and `frontend/src/components/ui/ControlPanel.tsx` contain mixed local edits and are excluded from the UI-0 commit. The standalone visual test page provides the review fixture without requiring those mixed files. The uncommitted diff has no author attribution, so ownership of those unrelated hunks is unconfirmed.
- Additional untracked local artifacts are `.venv311/` and a file literally named `frontend/src/App.tsx\`` (trailing backtick). They appear to be environment/backup artifacts, not UI-0 deliverables; owner is unconfirmed. Neither was modified or removed.
- The focused typecheck currently cannot pass until the remaining `App.tsx` error above is resolved or the unrelated placement-note hunk is restored/separated. The gallery type import was corrected; the placement-note behavior was left intact for review.
- **UI-0 changes:** `frontend/src/api/{types.ts,parse.ts,parse.test.ts}`, `frontend/src/sim/{viewModel.ts,viewModel.test.ts}`, `frontend/src/test/fixtures.ts`, `frontend/src/assets/{registry.ts,registry.test.ts,ASSET_HANDOFF.md}`, `frontend/src/components/canvas/{CelestialBody.tsx,UniverseCanvas.tsx,CelestialMaterial.tsx,CelestialMaterial.test.tsx,CelestialVisualTestScene.tsx}`, `frontend/visual-test.html`, `frontend/src/visual-test.tsx`, `frontend/public/assets/textures/*`, `scripts/build_ui0_textures.py`, `scripts/requirements-ui0-textures.txt`, and this report. The mixed `App.tsx`, `ControlPanel.tsx`, and `backend/models.py` changes are excluded.
