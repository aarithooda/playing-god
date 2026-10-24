// The sourced body catalogue is read once. It is optional: if the backend cannot serve it, the rest of the app works
// and the catalogue panel simply does not appear.
import { useEffect, useState } from "react";
import type { ApiClient } from "../api/client";
import type { CatalogueDto } from "../api/types";

const EMPTY: CatalogueDto = { notes: [], entries: [] };

export function useCatalogue(client: ApiClient): CatalogueDto {
  const [catalogue, setCatalogue] = useState<CatalogueDto>(EMPTY);
  useEffect(() => {
    let cancelled = false;
    client
      .getCatalogue()
      .then((c) => !cancelled && setCatalogue(c))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [client]);
  return catalogue;
}
