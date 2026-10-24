# UI-1 camera and view controls

## Base audit
The agreed `main` baseline already contains eased camera focus with follow, Fit view framing, independent Axes and Grid overlays, selected-body outlining, and narrow-screen sidebar behavior. Those behaviors were retained. This branch adds a responsive view toolbar to the Simulation controls rather than duplicating camera logic in the UI.

## Toolbar behavior
- Axes and Grid are independent accessible toggles. The Grid pressed state reflects the user's choice; 3D placement can temporarily show the grid without turning the preference on.
- Overview runs the existing Fit view transform and camera-frame reset across all current bodies.
- Focus is disabled without a selected body and delegates to the existing animated focus/follow path when enabled.
- At compact widths the buttons use shorter visible labels; their accessible names remain descriptive. The controls wrap inside the fixed-width Simulation sidebar, so the viewport remains unobstructed.
- The scene consumes the toolbar's shared view-state contract. Camera movement remains owned by the existing canvas camera rig; simulation, backend, and API contracts are unchanged.

## Visibility checks
Unit coverage exercises a 200-body system spanning large SI coordinates and verifies the fitted coordinate extent. A radius-range check confirms a very small rendered body remains at the existing 3 CSS px minimum while a much larger body remains larger. Existing focus tracking, sidebar framing, grid placement, and selection tests remain relevant.

## UI-0 integration boundary
No UI-0 asset package or approved provenance inventory was present in this checkout during this UI-1 change. No body texture or external asset was downloaded or represented as a surface texture. The UI-0 owner can integrate documented assets through the existing `CelestialBody` rendering seam in a separate coordinated increment.
