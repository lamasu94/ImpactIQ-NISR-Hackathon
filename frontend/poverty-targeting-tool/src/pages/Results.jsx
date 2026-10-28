import React, { useMemo, useState } from "react";
import { Stat, Bar, ErrorBox, fmt, fmtM } from "../components.jsx";
import { useApiClient } from "../api/ApiContext.jsx";

const PAGE = 8;

export default function Results({ scan, onBack, onExplain, onScanLost }) {
  const api = useApiClient();
  const [q, setQ] = useState("");
  const [district, setDistrict] = useState("");
  const [sort, setSort] = useState({ key: "predicted_spending", dir: 1 });
  const [page, setPage] = useState(0);
  const [dlError, setDlError] = useState(null);

  const { summary: s, inputs } = scan;
  const chosen = scan.households; // chosen households only, lowest predicted spending first
  const districts = useMemo(() => [...new Set(chosen.map((r) => r.district || "No district"))].sort(), [chosen]);

  const list = useMemo(() => {
    const out = chosen.filter((r) => (!q.trim() || String(r.hhid).includes(q.trim())) && (!district || (r.district || "No district") === district));
    return out.sort((a, b) => (a[sort.key] > b[sort.key] ? 1 : a[sort.key] < b[sort.key] ? -1 : 0) * sort.dir);
  }, [chosen, q, district, sort]);

  const pages = Math.max(1, Math.ceil(list.length / PAGE));
  const cur = Math.min(page, pages - 1);
  const slice = list.slice(cur * PAGE, cur * PAGE + PAGE);

  const byProgram = scan.by_program;
  const maxProg = Math.max(1, ...byProgram.map((p) => p.money));
  const topDistricts = scan.by_district.slice().sort((a, b) => b.money - a.money).slice(0, 5);
  const maxDist = Math.max(1, topDistricts[0]?.money || 1);

  const toggleSort = (key) => {
    setSort((c) => (c.key === key ? { key, dir: -c.dir } : { key, dir: 1 }));
    setPage(0);
  };
  const arrow = (k) => (sort.key === k ? (sort.dir === 1 ? " ▲" : " ▼") : "");

  const download = async () => {
    setDlError(null);
    try {
      await api.downloadScanCsv(scan.scan_id);
    } catch (e) {
      if (e.code === "NOT_FOUND") onScanLost();
      else setDlError(e);
    }
  };

  // Measured numbers exist only when the file had real spending (sol_jan).
  const m = s.measured;
  const gapValue = m ? m.poverty_gap_closed_pct : s.expected_poverty_gap_closed_pct;

  return (
    <>
      <div className="head-row">
        <div>
          <h1>Scan results</h1>
          <p className="lead" style={{ margin: 0 }}>
            {inputs.file_name}, budget {fmt(inputs.budget)} Rwf, fair share {inputs.fair ? "on" : "off"}
          </p>
        </div>
        <div className="actions">
          <button className="btn" onClick={onBack}>Change rules and re-run</button>
          <button className="btn primary" onClick={download}>Download results (CSV)</button>
        </div>
      </div>
      {dlError && <ErrorBox error={dlError} />}

      {scan.warnings?.length > 0 && (
        <div className="banner warn inline" role="status">
          <span>{scan.warnings.map((w) => w.message).join(" ")}</span>
        </div>
      )}

      <div className="grid4">
        <Stat label="Households scanned" value={fmt(s.households_scanned)} hint={`About ${fmt(s.expected_poor_households)} expected to be poor`} />
        <Stat label="Chosen for help" value={fmt(s.households_chosen)} tone="navy" hint={`${Number(s.share_chosen_pct).toFixed(1)}% of households`} />
        <Stat label="Budget used" value={`${fmtM(s.budget_used)} M`} hint={`of ${fmtM(s.budget)} M Rwf`} />
        <Stat
          label={m ? "Poverty gap closed (measured)" : "Poverty gap closed (expected)"}
          value={`${Number(gapValue).toFixed(1)}%`}
          tone="teal"
          hint={m ? "Using the real spending in your file" : "Estimate, no real spending in the file"}
        />
      </div>

      {m && (
        <section className="card" style={{ marginBottom: 16 }}>
          <h2>Measured results</h2>
          <p className="sub">Worked out from the real spending column in your file.</p>
          <div className="kpis3">
            <div className="kpi"><div className="t">Poor households reached</div><div className="n">{m.poor_households_reached_pct.toFixed(1)}%</div></div>
            <div className="kpi"><div className="t">Extremely poor reached</div><div className="n">{m.extremely_poor_reached_pct.toFixed(1)}%</div></div>
            <div className="kpi"><div className="t">Helped but not poor</div><div className="n">{m.helped_not_poor_pct.toFixed(1)}%</div></div>
          </div>
        </section>
      )}

      <div className="grid2">
        <section className="card">
          <h2>Money by program</h2>
          <p className="sub">Millions of Rwf and households helped</p>
          {byProgram.map((p) => (
            <div key={p.program_id} style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span>{p.program}</span>
                <b>{fmtM(p.money)} M Rwf, {fmt(p.households)} households</b>
              </div>
              <Bar pct={(p.money / maxProg) * 100} />
            </div>
          ))}
        </section>
        <section className="card">
          <h2>Money by district</h2>
          <p className="sub">Top {topDistricts.length} of {scan.by_district.length} districts, millions of Rwf</p>
          {topDistricts.map((d) => (
            <div className="barrow" style={{ "--lw": "100px" }} key={d.district}>
              <span className="name">{d.district}</span>
              <Bar pct={(d.money / maxDist) * 100} />
              <span className="val">{fmtM(d.money)}</span>
            </div>
          ))}
        </section>
      </div>

      <section className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
          <h2 style={{ fontSize: 18 }}>Households chosen for help</h2>
          <div className="tools">
            <input className="input" placeholder="Search household ID" aria-label="Search household ID" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} />
            <select className="input" style={{ width: 170 }} aria-label="Filter by district" value={district} onChange={(e) => { setDistrict(e.target.value); setPage(0); }}>
              <option value="">All districts</option>
              {districts.map((d) => <option key={d}>{d}</option>)}
            </select>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th className="sortable" onClick={() => toggleSort("hhid")}>Household ID{arrow("hhid")}</th>
                <th className="sortable" onClick={() => toggleSort("district")}>District{arrow("district")}</th>
                <th className="sortable r" onClick={() => toggleSort("predicted_spending")}>Estimated spending per adult per year{arrow("predicted_spending")}</th>
                <th className="sortable r" onClick={() => toggleSort("p_poor")}>Chance poor{arrow("p_poor")}</th>
                <th className="sortable" onClick={() => toggleSort("program")}>Program{arrow("program")}</th>
                <th className="sortable r" onClick={() => toggleSort("amount")}>Amount (Rwf){arrow("amount")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {slice.map((r) => (
                <tr key={r.hhid}>
                  <td><b>{r.hhid}</b></td>
                  <td>{r.district || "—"}</td>
                  <td className="r">{fmt(r.predicted_spending)}</td>
                  <td className="r">{Math.round(r.p_poor * 100)}%</td>
                  <td>{r.program}</td>
                  <td className="r">{fmt(r.amount)}</td>
                  <td className="r"><button className="link" onClick={() => onExplain(r.hhid)}>Why?</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!slice.length && <p className="empty">No chosen household matches. Clear the search or the district filter.</p>}
        </div>
        <div className="pager">
          <span>{list.length ? `Showing ${cur * PAGE + 1}–${cur * PAGE + slice.length} of ${fmt(list.length)} households` : "Showing 0 households"}</span>
          <div className="btns">
            <button className="btn small" disabled={cur === 0} onClick={() => setPage(cur - 1)}>Previous</button>
            <button className="btn small" disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)}>Next</button>
          </div>
        </div>
      </section>

      <p className="footnote">These are estimates from a model, not a final decision. Each household's reason is one click away on the Explain page.</p>
    </>
  );
}
