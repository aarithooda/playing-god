# UI-3 Body Catalogue and Editing

## Current frontend behavior

Creation and editing use the same BodyFields component. Fields are grouped into identity/appearance, physical properties, and position/motion. Create and edit are semantic forms; Enter submits them through the existing create or update callback. Field-level validation feedback is connected to inputs with aria-invalid and aria-describedby. Backend errors remain visible as alerts.

Deletion from the inspector requires an explicit second confirmation naming the body. Cancel leaves the body untouched. Confirm calls the existing delete operation; the confirmation stays open if the backend reports an error.

The physical radius input is labelled in metres and remains the value sent through the existing API. The UI separately previews the renderer's exaggerated display radius in scene units. That display value is read-only, is never submitted, and does not affect physics.

## API boundary

This prototype uses only the existing v1 contracts: POST /api/v1/bodies, PATCH /api/v1/bodies/{id}, and DELETE /api/v1/bodies/{id}. The backend remains authoritative for validation and state. No endpoint or API type was added.

## UI-0 asset registry integration dependency

No UI-0 asset registry or registry-backed assets were present in the current branch or the shared UI-0 worktree at the time of implementation. The form therefore retains the existing colorHex control and does not invent a parallel catalogue or claim that procedural/color bodies use sourced textures.

To complete registry-backed appearance selection, the UI-0 owner needs to provide the registry module and its stable asset identifiers, source/attribution metadata, and preview/resource paths. The current BodyDto has no asset identifier, so persisting an asset choice would also require an API-contract decision by the API owner. Until that contract exists, registry selection can only be a frontend preview and must not be sent as an unrecognized body field.