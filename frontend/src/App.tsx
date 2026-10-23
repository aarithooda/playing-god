import { useEffect, useState } from "react";

export default function App() {
  const [backend, setBackend] = useState("checking...");

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((d) => setBackend(d.status))
      .catch(() => setBackend("unreachable"));
  }, []);

  return (
    <main style={{ fontFamily: "sans-serif", textAlign: "center", marginTop: "20vh" }}>
      <h1>PLAYING GOD</h1>
      <p>Gravitational universe sandbox — placeholder.</p>
      <p>Backend: {backend}</p>
    </main>
  );
}
