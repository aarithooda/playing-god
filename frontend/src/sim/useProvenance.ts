// Whether the active Orbit Lab run is still controlled (only the intended change) and, if not, since when.
// Read from the backend's provenance record whenever the run's revision changes; never inferred in the browser.
import { useEffect, useRef, useState } from "react";
import type { ScopedClient } from "../api/client";
import type { UniverseProvenanceDto } from "../api/types";

export function useProvenance(client: ScopedClient, revision: number | null, enabled: boolean): UniverseProvenanceDto | null {
  const [provenance, setProvenance] = useState<UniverseProvenanceDto | null>(null);
  const seq = useRef(0);
  useEffect(() => {
    if (!enabled || revision === null) return;
    const mine = ++seq.current;
    let cancelled = false;
    client
      .getProvenance()
      .then((p) => !cancelled && mine === seq.current && setProvenance(p))
      .catch(() => undefined); // keep the last known record; the run badge then stays as it was
    return () => {
      cancelled = true;
    };
  }, [client, revision, enabled]);
  return enabled ? provenance : null;
}
