import React, { useEffect, useRef, useState } from "react";
import { Badge, ErrorBox, Loading, fmt } from "../components.jsx";
import { useApiClient, useAsync } from "../api/ApiContext.jsx";
import { ApiError } from "../api/errors.js";

const LEVEL = { pass: "pass", warning: "warn", info: "info", fail: "fail" };
const LABEL = { pass: "Pass", warning: "Warning", info: "Info", fail: "Fail" };

export default function Upload({ file, setFile, validation, setValidation, settings, setSettings, notice, clearNotice, onDone }) {
  const api = useApiClient();
  const inputRef = useRef(null);
  const [over, setOver] = useState(false);
  const [readError, setReadError] = useState("");
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [runError, setRunError] = useState(null);
  const [dlError, setDlError] = useState(null);

  const schema = useAsync(() => api.schema(), [api]);
  const sc = schema.data;
  const patch = (p) => setSettings((s) => ({ ...s, ...p }));

  // Fill in the defaults from GET /schema the first time it arrives.
  useEffect(() => {
    if (sc && !settings.ready) patch({ ready: true, budget: sc.default_budget, programs: sc.programs.map((p) => p.id) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sc]);

  // POST /validate as soon as a file is chosen.
  useEffect(() => {
    if (!file || validation) return;
    let alive = true;
    api.validate(file).then(
      (r) => alive && setValidation(r),
      (e) =>
        alive &&
        setValidation({
          ok: false, file_name: file.name, rows: 0, columns: 0,
          checks: [{ status: "fail", code: e.code || "SERVER_ERROR", message: e.message }],
        })
    );
    return () => { alive = false; };
  }, [file, validation, api, setValidation]);

  useEffect(() => {
    if (!running) return;
    setElapsed(0);
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [running]);

  const chooseFile = (f) => {
    setReadError("");
    setRunError(null);
    if (!f) return;
    if (!/\.csv$/i.test(f.name) && f.type !== "text/csv") {
      setReadError("That is not a CSV file. Choose a file that ends in .csv.");
      return;
    }
    setFile(f);
  };

  const run = async () => {
    setRunning(true);
    setRunError(null);
    try {
      const result = await api.scan({ file, budget: settings.budget, programs: settings.programs, fair: settings.fair });
      onDone(result);
    } catch (e) {
      setRunError(e instanceof ApiError ? e : new ApiError("SERVER_ERROR", e?.message || "The scan failed."));
    } finally {
      setRunning(false);
    }
  };

  const sample = async (withSpending) => {
    setDlError(null);
    try { await api.downloadSample(withSpending); } catch (e) { setDlError(e); }
  };

  const toggleProgram = (id) =>
    patch({ programs: settings.programs.includes(id) ? settings.programs.filter((k) => k !== id) : [...settings.programs, id] });

  const noProgram = settings.ready && settings.programs.length === 0;
  const budgetOk = settings.budget > 0;
  const checking = !!file && !validation;
  const blocked = !sc || !file || !validation || !validation.ok || noProgram || !budgetOk || running;

  return (
    <>
      <h1>Upload and scan</h1>
      <p className="lead">Send in a household file. The tool estimates who is poor, then decides who should get help from the budget you set.</p>

      {notice && (
        <div className="banner warn inline" role="alert">
          <span>{notice}</span>
          <button className="btn small" onClick={clearNotice}>Dismiss</button>
        </div>
      )}
      {schema.loading && <Loading what="the upload form" />}
      {schema.error && <ErrorBox error={schema.error} onRetry={schema.reload} />}

      {sc && (
        <div className="upload-layout">
          <div className="stack">
            <section className="card">
              <h3 className="stephead"><span className="stepno">1</span>Upload household file</h3>
              <div
                className={`drop ${over ? "over" : ""}`}
                onDragOver={(e) => { e.preventDefault(); setOver(true); }}
                onDragLeave={() => setOver(false)}
                onDrop={(e) => { e.preventDefault(); setOver(false); chooseFile(e.dataTransfer.files[0]); }}
              >
                <strong>Drop a CSV file here</strong>
                <p className="sub">One row per household, up to {fmt(sc.max_rows)} rows, with the same columns as our training table</p>
                <button className="btn" onClick={() => inputRef.current.click()}>Choose file</button>
                <input ref={inputRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => { chooseFile(e.target.files[0]); e.target.value = ""; }} />
              </div>
              {readError && <p className="err" style={{ margin: "10px 0 0" }} role="alert">{readError}</p>}
              {file && (
                <div className="filechip">
                  <span>
                    <b>{file.name}</b>
                    {validation && validation.rows > 0 ? `${fmt(validation.rows)} rows, ${validation.columns} columns` : checking ? "Checking…" : ""}
                  </span>
                  <button className="link" onClick={() => { setFile(null); setReadError(""); setRunError(null); }}>Remove</button>
                </div>
              )}
              <p className="sub" style={{ margin: "12px 0 0" }}>
                <button className="link" onClick={() => sample(false)}>Download a sample file</button> to see the format, or{" "}
                <button className="link" onClick={() => sample(true)}>one with real spending</button> to see measured results.
              </p>
              {dlError && <p className="err" role="alert" style={{ margin: "8px 0 0" }}>{dlError.message}</p>}
            </section>

            <section className="card">
              <h3 className="stephead"><span className="stepno">2</span>Set the rules</h3>
              <label className="field-label" htmlFor="budget">Budget (Rwf per year)</label>
              <input
                id="budget"
                className="input"
                style={{ maxWidth: 260 }}
                inputMode="numeric"
                value={settings.budget ? fmt(settings.budget) : ""}
                onChange={(e) => patch({ budget: Number(e.target.value.replace(/\D/g, "")) || 0, budgetEdited: true })}
              />
              <p className="sub" style={{ marginTop: 8 }}>
                Default is {fmt(sc.default_budget)} Rwf, what today's VUP support costs.{" "}
                {settings.budgetEdited && (
                  <button className="link" style={{ fontWeight: 600 }} onClick={() => patch({ budget: sc.default_budget, budgetEdited: false })}>
                    Reset to default
                  </button>
                )}
              </p>
              {!budgetOk && <p className="err" role="alert">Enter a budget above zero.</p>}

              <div className="field-label" style={{ marginTop: 18 }}>Programs the tool may use</div>
              {sc.programs.map((p) => (
                <label key={p.id} className="progrow">
                  <input type="checkbox" checked={settings.programs.includes(p.id)} onChange={() => toggleProgram(p.id)} />
                  <span>{p.name}</span>
                  <span>{fmt(p.cost_per_household)} Rwf per household</span>
                </label>
              ))}
              {noProgram && <p className="err" role="alert">Choose at least one program.</p>}

              <label className="fairbox">
                <input type="checkbox" checked={settings.fair} onChange={(e) => patch({ fair: e.target.checked })} />
                <span>
                  <b>Fair share for every district</b>
                  <p>Each district must get at least half of the money its number of poor households would earn it. Costs very little poverty reduction.</p>
                </span>
              </label>
            </section>

            <section className="card">
              <h3 className="stephead"><span className="stepno">3</span>Run the scan</h3>
              <div className="runrow">
                <button className="btn primary" disabled={blocked} onClick={run}>{running ? "Scanning…" : "Run AI scan"}</button>
                <p className="sub">
                  {running
                    ? `Scanning ${elapsed} s. A few seconds for 1,000 households, a minute or more for several thousand.`
                    : "The button is disabled until every file check passes."}
                </p>
              </div>
              {running && <div className="progress indeterminate" role="progressbar" aria-label="Scanning"><div /></div>}
              {runError && (
                <div style={{ marginTop: 14 }}>
                  <ErrorBox error={runError} />
                </div>
              )}
            </section>
          </div>

          <aside className="card" aria-live="polite">
            <h2>File checks</h2>
            <p className="sub">Run as soon as a file is chosen</p>
            {!file && <p className="sub">No file chosen yet. Choose a CSV to run the checks.</p>}
            {checking && <Loading what="file checks" />}
            {validation && validation.checks.map((c, i) => (
              <div className="check" key={`${c.code}-${i}`}>
                <Badge level={LEVEL[c.status] || "info"}>{LABEL[c.status] || c.status}</Badge>
                <span>{c.message}</span>
              </div>
            ))}
            <div className="divider sub">If a check fails, the message names the problem. Fix the file and choose it again.</div>
            <details className="cols">
              <summary>Required columns ({sc.required_columns.length})</summary>
              <ul>
                {sc.required_columns.map((c) => <li key={c.name}><code>{c.name}</code> {c.label}</li>)}
              </ul>
              {sc.optional_columns?.length > 0 && (
                <>
                  <div className="field-label" style={{ marginTop: 8 }}>Optional</div>
                  <ul>{sc.optional_columns.map((c) => <li key={c.name}><code>{c.name}</code> {c.label}</li>)}</ul>
                </>
              )}
            </details>
          </aside>
        </div>
      )}
    </>
  );
}
