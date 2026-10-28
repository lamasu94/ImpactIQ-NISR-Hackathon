import React, { useState } from "react";
import { Stat, Bar, Loading, ErrorBox, fmt, fmtM, pct1 } from "../components.jsx";
import { useApiClient, useAsync } from "../api/ApiContext.jsx";
import { DISTRICT_LAYOUT, STRATEGY_NOTES } from "../lib/layout.js";

export default function Overview() {
  const api = useApiClient();
  const { data, error, loading, reload } = useAsync(() => api.overview(), [api]);
  return (
    <>
      <h1>Overview</h1>
      <p className="lead">
        The current picture of poverty in Rwanda, and how well different ways of sharing a fixed budget work. These are
        estimates for today, not forecasts.
      </p>
      {loading && <Loading what="the overview" />}
      {error && <ErrorBox error={error} onRetry={reload} />}
      {data && <Body d={data} />}
    </>
  );
}

// Sequential ramp: light blue to navy, same hue as the bars.
function shade(p, max) {
  const t = Math.max(0, Math.min(1, p / max));
  const a = [219, 230, 241];
  const b = [31, 78, 121];
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * t));
  return { bg: `rgb(${c.join(",")})`, fg: t > 0.45 ? "#fff" : "#1a2230" };
}

function Body({ d }) {
  const [province, setProvince] = useState(null);
  const [hover, setHover] = useState(null);
  const items = d.strategies.items;
  const [strategy, setStrategy] = useState((items.find((s) => s.kind === "recommended") || items[0]).id);

  const districts = d.districts.map((x) => ({ ...x, ...(DISTRICT_LAYOUT[x.district_code] || {}), name: x.district }));
  const maxPoor = Math.max(...districts.map((x) => x.households_poor_pct), 1);
  const inProvince = districts.filter((x) => !province || x.province === province);
  const top5 = inProvince.slice().sort((a, b) => b.households_poor_pct - a.households_poor_pct).slice(0, 5);
  const tiles = districts.filter((x) => x.x != null);
  const cols = Math.max(...tiles.map((x) => x.x)) + 1;
  const rows = Math.max(...tiles.map((x) => x.y)) + 1;
  const hovered = districts.find((x) => x.district_code === hover);
  const sel = items.find((s) => s.id === strategy);
  const maxProv = Math.max(...d.by_province.map((p) => p.households_poor_pct), 1) * 1.15;
  const maxGap = Math.max(...items.map((s) => s.gap_closed_pct), 1) * 1.1;

  return (
    <>
      <div className="grid4">
        <Stat label="Households surveyed" value={fmt(d.survey.households)} hint={`All ${d.survey.districts} districts, ${fmt(d.survey.people)} people`} />
        <Stat label="People living in poverty" value={pct1(d.poverty.people_poor_pct)} tone="navy" hint="Matches the official NISR figure" />
        <Stat label="People in extreme poverty" value={pct1(d.poverty.people_extreme_pct)} tone="red" hint={`Below ${fmt(d.poverty.extreme_line)} Rwf per adult per year`} />
        <Stat label={`Model accuracy (R squared)`} value={Number(d.model.r2).toFixed(2)} tone="teal" hint={`${d.model.name}. Finds ${pct1(d.model.poor_found_same_size_pick_pct)} of poor households`} />
      </div>

      <div className="grid2">
        <section className="card">
          <h2>Poor households by province</h2>
          <p className="sub">Share of households below the poverty line. Select a province to filter the list and map.</p>
          {d.by_province.map((p) => (
            <button
              key={p.province}
              className={`barrow ${province === p.province ? "on" : ""}`}
              style={{ "--lw": "90px" }}
              aria-pressed={province === p.province}
              onClick={() => setProvince(province === p.province ? null : p.province)}
            >
              <span className="name">{p.province}</span>
              <Bar pct={(p.households_poor_pct / maxProv) * 100} dim={!!province && province !== p.province} />
              <span className="val">{pct1(p.households_poor_pct)}</span>
            </button>
          ))}

          <h2 style={{ marginTop: 24 }}>Districts with the most poverty</h2>
          <p className="sub">
            {province ? `Top ${top5.length} of ${inProvince.length} districts in ${province}` : `Top 5 of ${districts.length} districts`}
          </p>
          <table className="mini-table">
            <thead><tr><th>District</th><th>Households poor</th></tr></thead>
            <tbody>
              {top5.map((x) => (
                <tr key={x.district_code} className={hover === x.district_code ? "on" : ""} onMouseEnter={() => setHover(x.district_code)} onMouseLeave={() => setHover(null)}>
                  <td>{x.district}</td>
                  <td>{pct1(x.households_poor_pct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="card">
          <h2>District map</h2>
          <p className="sub">Shaded by share of poor households. Hover a district to see its numbers.</p>
          <div className="map" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` }}>
            {tiles.map((x) => {
              const c = shade(x.households_poor_pct, maxPoor);
              const dim = province && x.province !== province;
              return (
                <button
                  key={x.district_code}
                  className={`tile ${dim ? "dim" : ""}`}
                  style={{ gridColumn: x.x + 1, gridRow: x.y + 1, background: c.bg, color: c.fg }}
                  onMouseEnter={() => setHover(x.district_code)}
                  onMouseLeave={() => setHover(null)}
                  onFocus={() => setHover(x.district_code)}
                  onBlur={() => setHover(null)}
                  onClick={() => setProvince(province === x.province ? null : x.province)}
                  aria-label={`${x.district}, ${x.province}: ${pct1(x.households_poor_pct)} of households poor`}
                >
                  {x.district}
                </button>
              );
            })}
          </div>
          <p className="mapinfo" aria-live="polite">
            {hovered ? (
              <><b>{hovered.district}</b>{hovered.province ? ` (${hovered.province})` : ""}: {pct1(hovered.households_poor_pct)} of households are poor</>
            ) : (
              <span className="sub">Tile map: each square is one district, placed roughly where it sits in Rwanda.</span>
            )}
          </p>
          <div className="scale"><span>Less poverty</span><div className="ramp" /><span>More poverty</span></div>
        </section>
      </div>

      <section className="card">
        <h2>Same budget, different strategies</h2>
        <p className="sub">
          Share of the national poverty gap closed. Budget for every strategy: {fmtM(d.strategies.budget)} million Rwf, which is what today's VUP
          support costs. Select a strategy to read what it does.
        </p>
        {items.map((s) => (
          <button
            key={s.id}
            className={`barrow ${strategy === s.id ? "on" : ""}`}
            style={{ "--lw": "240px" }}
            aria-pressed={strategy === s.id}
            onClick={() => setStrategy(s.id)}
          >
            <span className="name">{s.name}</span>
            <Bar pct={(s.gap_closed_pct / maxGap) * 100} tone={s.kind === "recommended" ? "teal" : s.kind === "benchmark" ? "grey" : ""} />
            <span className="val">{pct1(s.gap_closed_pct)}</span>
          </button>
        ))}
        <div className="legend">
          <span><i style={{ background: "var(--navy)" }} />Strategy we compare</span>
          <span><i style={{ background: "var(--teal)" }} />Our recommended strategy</span>
          <span><i style={{ background: "var(--grey)" }} />Benchmark</span>
        </div>
        {sel && (
          <div className="note" aria-live="polite"><b>{sel.name}.</b> {STRATEGY_NOTES[sel.id] || ""}</div>
        )}
      </section>

      <p className="footnote">
        Sample-based estimates from {fmt(d.survey.households)} surveyed households. Poverty line: {fmt(d.poverty.poverty_line)} Rwf per adult per year (January 2024 prices).
      </p>
    </>
  );
}
