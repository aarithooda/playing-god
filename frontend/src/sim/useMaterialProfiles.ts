// The material profile registry is read once. It is optional: if the backend cannot serve it, the create form offers only
// "Unspecified" (the legacy merge) and the rest of the app works.
import { useEffect, useState } from "react";
import type { ApiClient } from "../api/client";
import type { MaterialProfileSummaryDto } from "../api/types";

const EMPTY: readonly MaterialProfileSummaryDto[] = [];

export function useMaterialProfiles(client: ApiClient): readonly MaterialProfileSummaryDto[] {
  const [profiles, setProfiles] = useState<readonly MaterialProfileSummaryDto[]>(EMPTY);
  useEffect(() => {
    let cancelled = false;
    client
      .listMaterialProfiles()
      .then((p) => !cancelled && setProfiles(p))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [client]);
  return profiles;
}
