# Body renderer metadata contract (`bodyType`, `assetKey`)

Status: implemented on `feature/body-render-metadata` (base `a265c42`), not merged. Backend only; physics untouched.

## 1. Four different fields

| Field | Owner | Meaning | Who may write it | Used by |
|---|---|---|---|---|
| `kind` | physics model | Coarse role: `"star"` or `"planet"`. | create, patch | emissive vs lit material today; unchanged |
| `bodyType` | renderer metadata | Visual class: `star`, `rocky-planet`, `gas-giant`, `ice-giant`, `asteroid`, `default`. | create, patch | choosing a generic look when there is no asset |
| `assetKey` | renderer metadata | Stable id of a specific asset (`"earth"`, `"proxima-centauri"`). `null` = none. | create, patch (null clears) | choosing a specific texture/model |
| `catalogueEntryId` | provenance | Which catalogue entry a body was copied from. Not patchable. | create | nothing in rendering; never infer an asset from it |

`name` is free text. Nothing in the backend or renderer may derive `bodyType` or `assetKey` from it.

## 2. `bodyType`

Allowed: `"star" | "rocky-planet" | "gas-giant" | "ice-giant" | "asteroid" | "default"`.

- Response: always present, never null.
- Create: optional. Omitted or `null` -> `"star"` if `kind` is `"star"`, else `"default"` (derived from `kind` only).
- Patch: optional; `null` is rejected (422). Omitted keeps the stored value.
- Consistency with `kind`: `"star"` requires `kind: "star"`, and a star may only be `"star"` or `"default"`. `"default"` fits either kind. Create violation -> 422. Patch violation, judged on the merged values (`kind` and `bodyType` after the patch), -> 409 and nothing changes. So `PATCH {kind:"star"}` on a `rocky-planet` body is refused; send `{kind:"star", bodyType:"star"}`.
- Unknown values are rejected by the backend (closed set), so the renderer only has to handle the six, plus a defensive fallback for a future server value.

## 3. `assetKey`

- Response: always present; string or `null`.
- Format (create and patch): `^[a-z0-9]+(-[a-z0-9]+)*$`, 1-64 characters. Anything else -> 422.
- The backend does **not** know which assets exist. A well-formed unknown key is accepted and returned unchanged; the renderer must fall back (section 7).
- Create: omitted or `null` -> `null`. Patch: omitted keeps it; explicit `null` clears it; a string replaces it.

## 4. Omission semantics (partial update)

`BodyUpdate` is applied from the fields the client actually sent. Omitted `bodyType` and `assetKey` are never touched by a patch of any other field (name, colour, mass, position, kind...). `assetKey: null` is the only null accepted by PATCH and means "clear". Metadata edits are not physical edits: they do not affect `controlled`, but they do bump `revision` like every other accepted mutation, and they are written to the edit audit.

## 5. Presets and catalogue

- Preset JSON body entries may carry `bodyType` and `assetKey` (both optional; absent -> derived defaults, `assetKey` null). The loader validates them with the API rules and fails the preset (`preset_invalid`) on a bad value. Solar System: Sun `star/sun`; Mercury, Venus, Earth, Mars `rocky-planet` with `assetKey` `mercury|venus|earth|mars`; Jupiter, Saturn `gas-giant` (`jupiter|saturn`); Uranus, Neptune `ice-giant` (`uranus|neptune`). Body ids are `body-sun`, `body-earth`...; display names are not (e.g. "Earth (system barycentre)").
- Catalogue (M5, not built): each entry's `visual` block should add `bodyType` and `assetKey`. "Add from catalogue" copies them into the create request together with `catalogueEntryId`. The server never derives `assetKey` from `catalogueEntryId`. Custom bodies send neither and get the defaults.
- Asset identity is not part of the physical-state digest (like `colorHex`), so changing it does not make a run "differ" from its preset.

## 6. Merger result

Existing physics is unchanged: the heavier body survives and keeps its id, name, colour and `kind`. New rule for its renderer metadata: `assetKey` becomes `null` and `bodyType` becomes the generic type for its `kind` (`"star"` for a star, else `"default"`). A merger product is a new object, so it must not keep the survivor's texture, and no explicit mapping from (type A + type B) -> asset is justified. The absorbed body disappears. Metadata of every other body is untouched. A client that wants a specific look can PATCH it afterwards.

Known cosmetic consequence: a merged Earth-plus-asteroid keeps the name and colour of the survivor while losing its texture. Changing name/colour on merge is out of scope.

## 7. Where the fields appear

`Body` (always both fields) is returned by: `GET /api/v1/simulation/state`, `POST /api/v1/simulation/step`, `POST /api/v1/simulation/reset`, `POST /api/v1/bodies`, `PATCH /api/v1/bodies/{id}`, all universe-scoped equivalents (`.../universes/{uid}/state|bodies|step|reset`), snapshot restore, and preset universes. History: `GET .../history` `bodies[id]` metadata gains `bodyType` and `assetKey` (state at the time of the last recorded sample for that body).

## 8. Compatibility

Additive. Requests: new optional fields, nothing required, old clients unaffected (`extra="forbid"` only rejects unknown names, and these are now known). Responses: two new keys on every body and on history body metadata; exact-key assertions in four existing tests were updated (`test_api.py` x2, `test_api_diagnostics.py`, `test_history.py`). No API version bump, no schema migration (state is in memory). Snapshots taken before a restart do not exist (in-memory), so there is no stored data to migrate. The frontend's `parse.ts` must accept the new keys if it is strict about extra keys.

## 9. Integration with Sonnet's branch

Commit 1 (`backend/models.py`, `backend/simulation.py`, four test assertions, new test file) is the contract. Commit 2 (preset loader + Solar System JSON) is coordinated with M3 files. `context/API_CONTRACT.md` was deliberately not edited; add this under "Universes", after the `kind` sentence:

> `Body` also carries `bodyType` (`"star"|"rocky-planet"|"gas-giant"|"ice-giant"|"asteroid"|"default"`, always present; omitted at create -> `"star"` for a star else `"default"`; patchable, not null) and `assetKey` (nullable `^[a-z0-9]+(-[a-z0-9]+)*$`, max 64; patchable, `null` clears; omitted keeps). Display metadata only. A merger result keeps `kind` but gets `assetKey: null` and the generic `bodyType`. Full text: `context/BODY_RENDER_METADATA.md`.

---

# Handoff for Nikhil (copy-ready)

**Fields on every body** (state, step, reset, create, update, universe-scoped versions, snapshot restore, preset universes):

```json
{ "id": "body-earth", "name": "Earth (system barycentre)", "kind": "planet", "catalogueEntryId": null,
  "bodyType": "rocky-planet", "assetKey": "earth", "colorHex": "#rrggbb", "...": "unchanged physics fields" }
```

- `bodyType`: `"star" | "rocky-planet" | "gas-giant" | "ice-giant" | "asteroid" | "default"`. Always present.
- `assetKey`: `string | null`. Always present. Lowercase kebab, <= 64 chars, e.g. `"earth"`, `"proxima-centauri"`.

**Requests** (`POST .../bodies`, `PATCH .../bodies/{id}`): optional `bodyType`, optional `assetKey`. On PATCH, omit a field to keep it; send `"assetKey": null` to clear it; never send `bodyType: null`. Star bodies must use `bodyType` `"star"` or `"default"`; non-stars must not use `"star"`. Violations: 422 on create, 409 on patch.

**Renderer rules**
1. Look up the asset by `assetKey` only. If it is `null`, missing, or not in your registry: use the generic visual for `bodyType`. If `bodyType` is not one you know: use the `default` visual (and `kind` for emissive). Never throw.
2. Never infer an asset from `name`, `id` or `catalogueEntryId`.
3. `colorHex` still applies to the generic fallbacks.
4. History frames carry `bodyType` and `assetKey` in their body metadata; use the same rules.

**Do not assume**
- That `assetKey` exists in your asset list: the backend accepts any well-formed key.
- That `assetKey` is set for custom bodies (it is `null` unless the user or a preset sets it).
- That a merged body keeps its texture: after a merger the survivor has `assetKey: null` and `bodyType` `"default"` (or `"star"` for a star). The texture can vanish between two frames; handle it.
- That `bodyType` follows `kind` changes: patching `kind` alone does not change `bodyType`.
- That names match keys: preset display names look like "Earth (system barycentre)"; use `assetKey`.

**Limitations**: no catalogue endpoint yet (M5 adds `bodyType`/`assetKey` to catalogue visuals); no server-side asset registry (planned: none; the frontend registry is authoritative); only the Solar System preset sets keys today.

**Message to send Nikhil**: "Nikhil, the body metadata contract is ready on branch `feature/body-render-metadata` (not merged). Every body now has `bodyType` (star | rocky-planet | gas-giant | ice-giant | asteroid | default, always present) and `assetKey` (string or null). Code against that now; the field names will not change. Read `context/BODY_RENDER_METADATA.md` on that branch for rules and fallbacks. Until it is merged into the Simulation Lab branch the running backend won't send the fields, so make your parser tolerate them being absent (treat as `bodyType: "default"`, `assetKey: null`)."
