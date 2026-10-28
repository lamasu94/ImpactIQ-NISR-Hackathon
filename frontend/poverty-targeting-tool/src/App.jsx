import React, { useCallback, useEffect, useMemo, useState } from "react";
import Overview from "./pages/Overview.jsx";
import Upload from "./pages/Upload.jsx";
import Results from "./pages/Results.jsx";
import Explain from "./pages/Explain.jsx";
import { ApiProvider } from "./api/ApiContext.jsx";
import { realApi, BASE_URL } from "./api/client.js";
import { mockApi } from "./mock/mockApi.js";

const FORCE_DEMO = (import.meta.env || {}).VITE_USE_MOCK === "true";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "upload", label: "Upload and scan" },
  { key: "explain", label: "Explain and fairness" },
];

const FRESH_SETTINGS = { ready: false, budget: 0, budgetEdited: false, programs: [], fair: true };

export default function App() {
  const [mode, setMode] = useState("checking"); // checking | live | demo
  const [banner, setBanner] = useState(null);
  const [notice, setNotice] = useState("");
  const [page, setPage] = useState("overview");

  const [file, setFileState] = useState(null);
  const [validation, setValidation] = useState(null);
  const [settings, setSettings] = useState(FRESH_SETTINGS);
  const [scan, setScan] = useState(null);
  const [target, setTarget] = useState({ hhid: "302154", source: "survey" });

  const api = mode === "demo" ? mockApi : realApi;

  const setFile = useCallback((f) => {
    setFileState(f);
    setValidation(null);
  }, []);

  const connect = useCallback(async () => {
    setMode("checking");
    setBanner(null);
    setFile(null);
    setScan(null);
    setSettings(FRESH_SETTINGS);
    setTarget({ hhid: "302154", source: "survey" });
    if (FORCE_DEMO) {
      setMode("demo");
      setBanner({ tone: "info", text: "Demo mode (VITE_USE_MOCK=true). Numbers come from a built-in stand-in model, not the real backend." });
      return;
    }
    try {
      const h = await realApi.health();
      setMode("live");
      if (h && h.model_loaded === false) setBanner({ tone: "warn", text: "The backend is running but its model is not loaded. Scans will fail until it is." });
    } catch {
      setMode("demo");
      setBanner({ tone: "warn", text: `Could not reach the backend at ${BASE_URL}. Showing demo data from a built-in stand-in model.`, retry: true });
    }
  }, [setFile]);

  useEffect(() => {
    connect();
  }, [connect]);

  const goExplain = (hhid) => {
    setTarget({ hhid: String(hhid), source: scan ? "scan" : "survey" });
    setPage("explain");
    window.scrollTo({ top: 0 });
  };

  // The backend keeps scans in memory, so a restart makes a scan id unknown (NOT_FOUND).
  const scanLost = () => {
    setScan(null);
    setTarget((t) => ({ ...t, source: "survey" }));
    setNotice("That scan is no longer available, probably because the backend was restarted. Choose the file and run the scan again.");
    setPage("upload");
    window.scrollTo({ top: 0 });
  };

  const activeTab = page === "results" ? "upload" : page;
  const ctx = useMemo(() => api, [api]);

  return (
    <ApiProvider value={ctx}>
      <header className="topbar">
        <span className="brand">Poverty Targeting Tool</span>
        <nav style={{ display: "flex", gap: 4 }} aria-label="Main">
          {TABS.map((t) => (
            <button
              key={t.key}
              className={`tab ${activeTab === t.key ? "active" : ""}`}
              aria-current={activeTab === t.key ? "page" : undefined}
              onClick={() => { setPage(t.key); window.scrollTo({ top: 0 }); }}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <span className="source">Data: EICV7 household survey, 2023-24</span>
      </header>

      {banner && (
        <div className={`banner ${banner.tone}`} role="status">
          <span>{banner.text}</span>
          {banner.retry && <button className="btn small" onClick={connect}>Retry connection</button>}
        </div>
      )}

      <main className="page">
        {mode === "checking" && (
          <div className="loading" role="status"><div className="spinner" />Connecting to the backend…</div>
        )}
        {mode !== "checking" && page === "overview" && <Overview key={mode} />}
        {mode !== "checking" && page === "upload" && (
          <Upload
            key={mode}
            file={file}
            setFile={setFile}
            validation={validation}
            setValidation={setValidation}
            settings={settings}
            setSettings={setSettings}
            notice={notice}
            clearNotice={() => setNotice("")}
            onDone={(r) => {
              setScan(r);
              setNotice("");
              setTarget((t) => ({ ...t, source: "scan" }));
              setPage("results");
              window.scrollTo({ top: 0 });
            }}
          />
        )}
        {mode !== "checking" && page === "results" && scan && (
          <Results key={scan.scan_id} scan={scan} onBack={() => setPage("upload")} onExplain={goExplain} onScanLost={scanLost} />
        )}
        {mode !== "checking" && page === "explain" && (
          <Explain key={mode} scan={scan} target={target} setTarget={setTarget} onScanLost={scanLost} />
        )}
      </main>
    </ApiProvider>
  );
}
