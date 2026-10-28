import React, { useState } from "react";
import { Badge, Bar, ErrorBox, Loading, fmt, pct1 } from "../components.jsx";
import { useApiClient, useAsync } from "../api/ApiContext.jsx";

export default function Explain({ scan, target, setTarget, onScanLost }) {
  const api = useApiClient();
  const [draft, setDraft] = useState(target.hhid);
  const [idError, setIdError] = useState("");
  const [view, setView] = useState("groups");

  const source = scan ? target.source : "survey";
  const scanId = source === "scan" ? scan.scan_id : null;
  const validId = /^\d+$/.test(target.hhid.trim());

  const hh = useAsync(() => (validId ? api.household(target.hhid.trim(), scanId) : Promise.resolve(null)), [api, target.hhid, scanId, validId]);
  const fair = useAsync(() => api.fairness(), [api]);

  const submit = (e) => {
    e.preventDefault();
    if (!/^\d+$/.test(draft.trim())) {
      setIdError("A household ID is a whole number, for example 302154.");
      return;
    }
    setIdError("");
    setTarget({ hhid: draft.trim(), source });
  };

  const h = hh.data;
  const maxAbs = h ? Math.max(1, ...h.pushed_down.map((x) => Math.abs(x.effect_pct)), ...h.pushed_up.map((x) => Math.abs(x.effect_pct))) : 1;
  const notFound = hh.error?.code === "NOT_FOUND";

  return (
    <>
      <h1>Explain and fairness</h1>
      <p className="lead">See why the model scored a household the way it did, and check that the results are fair to every group.</p>

      <div className="explain-layout">
        <section className="card">
          <h2 style={{ fontSize: 18, marginBottom: 14 }}>Why this household?</h2>
          <form onSubmit={submit}>
            <label className="field-label" htmlFor="hid">Household ID</label>
            <div className="idrow">
              <input id="hid" className="input" value={draft} onChange={(e) => setDraft(e.target.value)} inputMode="numeric" />
              <button className="btn primary" type="submit">Explain</button>
            </div>
          </form>
          {idError && <p className="err" role="alert">{idError}</p>}

          <div className="seg" role="group" aria-label="Where to look the household up">
            <button className={source === "survey" ? "on" : ""} onClick={() => setTarget({ ...target, source: "survey" })}>Survey data</button>
            <button className={source === "scan" ? "on" : ""} disabled={!scan} title={scan ? "" : "Run a scan first"} onClick={() => setTarget({ ...target, source: "scan" })}>Your last scan</button>
          </div>

          {hh.loading && <Loading what="the household" />}
          {hh.error && !notFound && <ErrorBox error={hh.error} onRetry={hh.reload} />}
          {notFound && (
            <ErrorBox error={hh.error}>
              {source === "scan" && (
                <>
                  <button className="btn small" onClick={() => setTarget({ ...target, source: "survey" })}>Look in survey data</button>
                  <button className="btn small" onClick={onScanLost}>Run the scan again</button>
                </>
              )}
            </ErrorBox>
          )}

          {h && !hh.loading && (
            <>
              <div className="kpis3">
                <div className="kpi"><div className="t">Typical household</div><div className="n">{fmt(h.typical_spending)}</div><div className="s">Rwf per adult per year</div></div>
                <div className={`kpi ${h.predicted_spending < h.poverty_line ? "bad" : ""}`}>
                  <div className="t">Model's guess</div>
                  <div className="n">{fmt(h.predicted_spending)}</div>
                  <div className="s">{h.predicted_spending < h.poverty_line ? "Below" : "Above"} the {fmt(h.poverty_line)} poverty line. Chance poor: {Math.round(h.p_poor * 100)}%</div>
                </div>
                <div className="kpi">
                  <div className="t">Real spending</div>
                  <div className="n">{h.true_spending != null ? fmt(h.true_spending) : "Not known"}</div>
                  <div className="s">{h.true_spending != null ? "From the survey or your file" : "Not in the data"}</div>
                </div>
              </div>

              <div className="h-red">Pushed the guess down (poorer)</div>
              {h.pushed_down.length ? h.pushed_down.map((x) => (
                <div className="expl" key={x.clue}>
                  <span>{x.label}: <b>{x.value}</b></span>
                  <Bar pct={(Math.abs(x.effect_pct) / maxAbs) * 100} tone="red" />
                  <span className="num">{x.effect_pct}%</span>
                </div>
              )) : <p className="sub">Nothing pushed the guess down.</p>}

              <div className="h-teal">Pushed the guess up (richer)</div>
              {h.pushed_up.length ? h.pushed_up.map((x) => (
                <div className="expl" key={x.clue}>
                  <span>{x.label}: <b>{x.value}</b></span>
                  <Bar pct={(Math.abs(x.effect_pct) / maxAbs) * 100} tone="teal" />
                  <span className="num">+{x.effect_pct}%</span>
                </div>
              )) : <p className="sub">Nothing pushed the guess up.</p>}

              <p className="sub" style={{ marginTop: 14 }}>
                Each bar shows how much that clue moved the guess compared with a typical household. Real spending is only known for surveyed households and files that include it.
              </p>

              {h.decision && (
                <div className={`decision ${h.decision.chosen ? "" : "no"}`}>
                  {h.decision.chosen
                    ? `In your last scan this household was chosen for ${h.decision.program} (${fmt(h.decision.amount)} Rwf).`
                    : "In your last scan this household was not chosen for help."}
                </div>
              )}
            </>
          )}
        </section>

        <section className="card">
          <h2 style={{ fontSize: 18 }}>Is it fair?</h2>
          <p className="sub">Survey results of the optimized and fair strategy, by group. Amber means the team should review it.</p>
          {fair.loading && <Loading what="fairness results" />}
          {fair.error && <ErrorBox error={fair.error} onRetry={fair.reload} />}
          {fair.data && <Fairness d={fair.data} view={view} setView={setView} />}
        </section>
      </div>
    </>
  );
}

function Fairness({ d, view, setView }) {
  const rows = view === "groups" ? d.groups : d.districts;
  const flaggedGroups = d.groups.filter((g) => g.status === "review");
  const flaggedDistricts = d.districts.filter((g) => g.status === "review");
  const label = (r) => (view === "groups" ? r.group : r.district);

  let lastType = null;
  const body = [];
  rows.forEach((r, i) => {
    if (view === "groups" && r.type !== lastType) {
      lastType = r.type;
      body.push(<tr key={`t-${r.type}`} className="typerow"><td colSpan={5}>{r.type}</td></tr>);
    }
    const review = r.status === "review";
    body.push(
      <tr key={`${view}-${i}`}>
        <td>{label(r)}</td>
        <td>{pct1(r.poor_pct)}</td>
        <td className={review ? "flag" : ""}>{pct1(r.poor_helped_pct)}</td>
        <td className={review ? "flag" : ""}>{pct1(r.helped_not_poor_pct)}</td>
        <td><Badge level={review ? "review" : "ok"}>{review ? "Review" : "OK"}</Badge></td>
      </tr>
    );
  });

  return (
    <>
      <div className="seg" role="group" aria-label="Fairness view">
        <button className={view === "groups" ? "on" : ""} onClick={() => setView("groups")}>By group</button>
        <button className={view === "districts" ? "on" : ""} onClick={() => setView("districts")}>By district ({d.districts.length})</button>
      </div>
      <div className={view === "districts" ? "scroll" : ""}>
        <table className="mini-table fair" style={{ marginTop: 6 }}>
          <thead>
            <tr><th>{view === "groups" ? "Group" : "District"}</th><th>Households poor</th><th>Poor who get help</th><th>Helped but not poor</th><th /></tr>
          </thead>
          <tbody>{body}</tbody>
        </table>
      </div>

      {flaggedGroups.length + flaggedDistricts.length > 0 ? (
        <div className="review-box">
          <b>What needs review.</b>{" "}
          {flaggedGroups.map((g) => `${g.group} (${g.type.toLowerCase()}): ${pct1(g.poor_helped_pct)} of poor households get help and ${pct1(g.helped_not_poor_pct)} of those helped are not poor.`).join(" ")}
          {flaggedDistricts.length > 0 && (
            <>
              {" "}{flaggedDistricts.length} district{flaggedDistricts.length > 1 ? "s are" : " is"} flagged:{" "}
              {flaggedDistricts.map((x) => x.district).join(", ")}.{" "}
              {view === "groups" && <button className="link" onClick={() => setView("districts")}>See districts</button>}
            </>
          )}
        </div>
      ) : (
        <div className="decision">No group or district needs review.</div>
      )}

      <div className="field-label" style={{ marginTop: 18 }}>Clues the model relies on most</div>
      <div className="chips">{d.top_clues.map((c) => <span key={c} className="chip">{c}</span>)}</div>
    </>
  );
}
