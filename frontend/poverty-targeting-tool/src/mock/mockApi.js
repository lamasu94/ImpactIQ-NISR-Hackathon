// Demo backend. Used when the real API is not reachable (or VITE_USE_MOCK=true).
// It returns the same shapes as API_CONTRACT.md. The "model" is a hand-set formula,
// NOT the trained LightGBM model, so numbers are illustrative only.
import { ApiError } from "../api/errors.js";
import { saveBlob } from "../api/download.js";
import { DISTRICT_LAYOUT } from "../lib/layout.js";

const POVERTY_LINE = 560127;
const EXTREME_LINE = 356432;
const TYPICAL_SPENDING = 848344;
const DEFAULT_BUDGET = 209800274;
const SURVEY_HOUSEHOLDS = 15054;
const MAX_ROWS = 5000;
const MODEL_ERROR = 0.35;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r1 = (x) => Math.round(x * 10) / 10;

const PROGRAMS = [
  { id: "direct_support", name: "Direct Support", cost_per_household: 128572 },
  { id: "classic_pw", name: "Classic Public Works", cost_per_household: 87994 },
  { id: "expanded_pw", name: "Expanded Public Works", cost_per_household: 149422 },
];

// Share of households below the poverty line, by district code (illustrative except the top five).
const POOR = {
  11: 8.9, 12: 5.5, 13: 5.9, 21: 39.1, 22: 39.9, 23: 37.7, 24: 22.0, 25: 43.6, 26: 27.0, 27: 22.3,
  28: 20.5, 31: 28.0, 32: 33.0, 33: 24.5, 34: 30.4, 35: 34.5, 36: 27.5, 37: 38.7, 41: 14.5, 42: 19.5,
  43: 14.0, 44: 22.0, 45: 18.0, 51: 19.5, 52: 19.0, 53: 20.8, 54: 24.1, 55: 28.0, 56: 21.5, 57: 25.2,
};
const BY_NAME = Object.fromEntries(Object.entries(DISTRICT_LAYOUT).map(([c, d]) => [d.name, { code: Number(c), province: d.province, poor: POOR[c] }]));

/* ------------------------------ columns ------------------------------ */

const CLUES = [
  ["district", "District", "category"],
  ["province", "Province", "category"],
  ["urban_rural", "City or countryside", "category"],
  ["household_size", "Household size", "number"],
  ["n_belongings", "Total belongings owned", "number"],
  ["n_belonging_types", "Different kinds of belongings", "number"],
  ["people_per_room", "People per sleeping room", "number"],
  ["owns_mattress", "Owns mattresses", "category"],
  ["share_women", "Share of members who are women", "number"],
  ["floor_material", "Floor material", "category"],
  ["owns_iron", "Owns an electric iron", "category"],
  ["head_sex", "Sex of household head", "category"],
  ["member_disability", "Member with serious disability", "category"],
  ["adults_able_to_work", "Adults able to work", "number"],
];
const FILLER = Array.from({ length: 86 }, (_, i) => [`clue_${String(i + 1).padStart(2, "0")}`, `Extra clue ${i + 1}`, "number"]);
const REQUIRED = [["hhid", "Household ID", "number"], ["ae", "Adult equivalents", "number"], ...CLUES, ...FILLER];
const REQUIRED_NAMES = REQUIRED.map((c) => c[0]);
const NUMERIC = REQUIRED.filter((c) => c[2] === "number" && !c[0].startsWith("clue_")).map((c) => c[0]);
const BANNED = ["poverty_status", "poverty_code", "poor", "extreme_poor", "consumption", "consumption_quintile", "total_spending"];

/* -------------------------------- CSV -------------------------------- */

function parseCSV(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let q = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"' && s[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); if (row.length > 1 || row[0] !== "") rows.push(row); }
  if (!rows.length) return { header: [], rows: [] };
  const header = rows[0].map((h) => h.trim());
  return { header, rows: rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? "").trim()]))) };
}
const esc = (v) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const toCSV = (header, rows) => [header.join(","), ...rows.map((r) => header.map((h) => esc(r[h])).join(","))].join("\n");
const yes = (v) => ["yes", "y", "1", "true"].includes(String(v).trim().toLowerCase());
const csvBlob = (text) => new Blob([text], { type: "text/csv;charset=utf-8" });

/* ------------------------------- model ------------------------------- */

function normCdf(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}
const FLOOR = { earth: -0.08, wood: 0, cement: 0.03, tile: 0.12 };
const pct = (e) => Math.round((Math.exp(e) - 1) * 100);

function predict(r) {
  const size = Number(r.household_size);
  const sh = Number(r.share_women);
  const floor = String(r.floor_material || "").toLowerCase();
  const urban = String(r.urban_rural || "").toLowerCase() === "urban";
  const dPoor = BY_NAME[r.district]?.poor;
  const effects = [
    { key: "household_size", label: "Household size", value: String(size), e: -0.075 * (size - 4) },
    { key: "district", label: "District", value: r.district || "unknown", e: dPoor == null ? 0 : -0.9 * (dPoor / 100 - 0.274) },
    { key: "n_belongings", label: "Total belongings owned", value: String(r.n_belongings), e: 0.021 * (Number(r.n_belongings) - 6) },
    { key: "people_per_room", label: "People per sleeping room", value: String(r.people_per_room), e: -0.063 * (Number(r.people_per_room) - 2) },
    { key: "n_belonging_types", label: "Different kinds of belongings", value: String(r.n_belonging_types), e: 0.021 * (Number(r.n_belonging_types) - 6) },
    { key: "owns_mattress", label: "Owns: mattresses", value: yes(r.owns_mattress) ? "yes" : "no", e: yes(r.owns_mattress) ? 0.01 : -0.03 },
    { key: "share_women", label: "Share of members who are women", value: sh.toFixed(2), e: 0.03 * (sh - 0.33) },
    { key: "floor_material", label: "Floor material", value: floor || "unknown", e: FLOOR[floor] ?? 0 },
    { key: "owns_iron", label: "Owns an electric iron", value: yes(r.owns_iron) ? "yes" : "no", e: yes(r.owns_iron) ? 0.05 : -0.03 },
    { key: "urban_rural", label: "City or countryside", value: urban ? "urban" : "rural", e: urban ? 0.08 : -0.03 },
  ];
  const total = -0.08 + effects.reduce((s, x) => s + x.e, 0);
  return { guess: Math.round(TYPICAL_SPENDING * Math.exp(total)), effects };
}

/* ---------------------------- sample file ---------------------------- */

function rng(seed) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generateSample(n = 1000, withSpending = false) {
  const rand = rng(2024);
  const noise = rng(7);
  const list = Object.entries(BY_NAME);
  const weights = list.map(([, d]) => 1 + d.poor / 60);
  const wsum = weights.reduce((a, b) => a + b, 0);
  const pickDistrict = () => {
    let t = rand() * wsum;
    for (let i = 0; i < list.length; i++) { t -= weights[i]; if (t <= 0) return list[i]; }
    return list[0];
  };
  const rows = [];
  for (let i = 0; i < n; i++) {
    const [name, d] = pickDistrict();
    const urban = rand() < (d.province === "Kigali City" ? 0.8 : 0.14);
    const size = Math.max(1, Math.min(10, Math.round(4.7 + (rand() + rand() + rand() - 1.5) * 2.6)));
    const rooms = Math.max(1, Math.min(5, Math.round(1 + rand() * 2.4 + (urban ? 0.8 : 0))));
    const p = d.poor / 100;
    const belong = Math.max(0, Math.min(14, Math.round(6.5 - p * 6 + (urban ? 1.5 : 0) + (rand() - 0.5) * 6)));
    const r = {
      hhid: 302000 + i,
      ae: Math.round(size * 0.82 * 100) / 100,
      district: name,
      province: d.province,
      urban_rural: urban ? "Urban" : "Rural",
      household_size: size,
      n_belongings: belong,
      n_belonging_types: Math.max(0, Math.min(belong, Math.round(belong * (0.6 + rand() * 0.4)))),
      people_per_room: Math.max(1, Math.round(size / rooms)),
      owns_mattress: rand() < 0.55 - p * 0.5 + (urban ? 0.25 : 0) ? "yes" : "no",
      share_women: Math.round((0.15 + rand() * 0.7) * 100) / 100,
      floor_material: rand() < 0.5 - (urban ? 0.3 : 0) + p * 0.4 ? "earth" : urban && rand() < 0.3 ? "tile" : "cement",
      owns_iron: rand() < 0.15 + (urban ? 0.35 : 0) - p * 0.2 ? "yes" : "no",
      head_sex: rand() < 0.28 ? "woman" : "man",
      member_disability: rand() < 0.08 + p * 0.1 ? "yes" : "no",
      adults_able_to_work: rand() < 0.14 ? 0 : Math.max(1, Math.min(size, Math.round(1 + rand() * 2.4))),
    };
    FILLER.forEach(([c]) => (r[c] = Math.round(rand() * 100) / 100));
    rows.push(r);
  }
  // The household used in the "Why this household?" example.
  Object.assign(rows[154], {
    hhid: 302154, ae: 4.9, district: "Nyanza", province: "Southern", urban_rural: "Rural", household_size: 6,
    n_belongings: 3, n_belonging_types: 3, people_per_room: 3, owns_mattress: "yes", share_women: 0.67,
    floor_material: "earth", owns_iron: "no", adults_able_to_work: 2,
  });
  const header = [...REQUIRED_NAMES];
  if (withSpending) {
    header.push("sol_jan");
    rows.forEach((r) => {
      const z = (noise() + noise() + noise() - 1.5) * 2;
      r.sol_jan = r.hhid === 302154 ? 296525 : Math.round(predict(r).guess * Math.exp(z * 0.3));
    });
  }
  return { header, rows };
}

let surveyCache = null;
const survey = () => (surveyCache ||= generateSample(1000, true));

/* ------------------------------ validate ------------------------------ */

function checkFile(parsed, fileName) {
  const checks = [];
  const have = new Set(parsed.header);
  const missing = REQUIRED_NAMES.filter((c) => !have.has(c));
  const banned = BANNED.filter((c) => have.has(c));
  if (!parsed.header.length || !parsed.rows.length) {
    checks.push({ status: "fail", code: "NOT_A_CSV", message: "The file has no household rows, or cannot be read as CSV." });
  } else {
    if (missing.length) {
      checks.push({ status: "fail", code: "MISSING_COLUMNS", message: `The file is missing ${missing.length} required column${missing.length > 1 ? "s" : ""}: ${missing.slice(0, 4).join(", ")}${missing.length > 4 ? ` and ${missing.length - 4} more` : ""}.` });
    } else checks.push({ status: "pass", code: "COLUMNS_OK", message: "All 100 clue columns found" });

    if (banned.length) checks.push({ status: "fail", code: "BANNED_COLUMNS", message: `Banned column${banned.length > 1 ? "s" : ""} in the file: ${banned.join(", ")}. Remove ${banned.length > 1 ? "them" : "it"}.` });
    else checks.push({ status: "pass", code: "NO_BANNED", message: "No banned columns (spending, poverty codes) in the file" });

    if (have.has("hhid")) {
      const seen = new Set();
      let dup = 0;
      parsed.rows.forEach((r) => { if (seen.has(r.hhid)) dup++; else seen.add(r.hhid); });
      if (dup) checks.push({ status: "fail", code: "DUPLICATE_HHID", message: `${dup} repeated household ID${dup > 1 ? "s" : ""}. Every household needs a unique hhid.` });
      else checks.push({ status: "pass", code: "HHID_UNIQUE", message: "Every household has a unique ID" });
    }
    if (parsed.rows.length > MAX_ROWS) checks.push({ status: "fail", code: "TOO_MANY_ROWS", message: `The file has ${parsed.rows.length.toLocaleString()} rows. The limit is ${MAX_ROWS.toLocaleString()}.` });

    if (!missing.length) {
      const bad = parsed.rows.filter((r) => NUMERIC.some((c) => r[c] === "" || !Number.isFinite(Number(r[c])))).length;
      if (bad) checks.push({ status: "fail", code: "BAD_VALUES", message: `${bad} row${bad > 1 ? "s have" : " has"} a missing or non-numeric value in a number column.` });
    }
    if (have.has("district")) {
      const empty = parsed.rows.filter((r) => !r.district).length;
      if (empty) checks.push({ status: "warning", code: "EMPTY_DISTRICT", message: `${empty} household${empty > 1 ? "s have" : " has"} an empty district. They will still be scanned, but cannot count towards a district's fair share.` });
    }
    if (have.has("sol_jan")) checks.push({ status: "info", code: "HAS_SPENDING", message: "Real spending column found. Results will include measured numbers." });
    else checks.push({ status: "info", code: "NO_SPENDING", message: "No real spending column found. Results will be estimates only." });
  }
  return { ok: !checks.some((c) => c.status === "fail"), file_name: fileName, rows: parsed.rows.length, columns: parsed.header.length, checks };
}

async function readCsv(file) {
  try {
    return parseCSV(await file.text());
  } catch {
    throw new ApiError("NOT_A_CSV", "The file cannot be read as CSV.", [], 400);
  }
}

/* -------------------------------- scan -------------------------------- */

const SCANS = new Map();

async function runScan({ file, budget, programs, fair }) {
  await sleep(1200);
  const parsed = await readCsv(file);
  const v = checkFile(parsed, file.name);
  const fail = v.checks.find((c) => c.status === "fail");
  if (fail) throw new ApiError(fail.code, fail.message, [], 400);
  if (!(Number(budget) > 0)) throw new ApiError("BAD_BUDGET", "Budget must be above zero.", [], 400);
  const active = PROGRAMS.filter((p) => (programs || []).includes(p.id));
  if (!active.length) throw new ApiError("NO_PROGRAMS", "Choose at least one program.", [], 400);

  // The backend works on a sample, so the budget is scaled to the share of the survey it represents.
  const eff = (Number(budget) * parsed.rows.length) / SURVEY_HOUSEHOLDS;
  const scored = parsed.rows.map((r) => {
    const { guess } = predict(r);
    const d = BY_NAME[r.district];
    const real = r.sol_jan !== undefined && r.sol_jan !== "" ? Number(r.sol_jan) : null;
    return {
      row: r, hhid: Number(r.hhid), district: r.district || "", code: d?.code ?? null,
      canWork: Number(r.adults_able_to_work) > 0, guess, gap: Math.max(0, POVERTY_LINE - guess),
      poor: guess < POVERTY_LINE, pPoor: normCdf(Math.log(POVERTY_LINE / guess) / MODEL_ERROR), real,
    };
  });
  const totalGap = scored.reduce((s, h) => s + h.gap, 0);

  const options = [];
  scored.forEach((h) => {
    if (!h.poor) return;
    const eligible = active.filter((p) => (p.id === "direct_support" ? !h.canWork : h.canWork));
    let best = null;
    eligible.forEach((p) => {
      const used = Math.min(p.cost_per_household, h.gap) / p.cost_per_household;
      if (!best || used > best.used + 0.02 || (Math.abs(used - best.used) <= 0.02 && p.cost_per_household > best.p.cost_per_household)) best = { p, used };
    });
    if (best) options.push({ h, p: best.p, used: best.used, benefit: Math.min(best.p.cost_per_household, h.gap) });
  });
  options.sort((a, b) => Math.round(b.used * 20) - Math.round(a.used * 20) || b.h.gap - a.h.gap);

  const chosen = new Map();
  let spent = 0;
  const take = (o) => {
    if (chosen.has(o.h.hhid) || spent + o.p.cost_per_household > eff) return false;
    chosen.set(o.h.hhid, o);
    spent += o.p.cost_per_household;
    return true;
  };
  if (fair) {
    const per = {};
    let total = 0;
    scored.forEach((h) => { if (h.poor && h.district) { per[h.district] = (per[h.district] || 0) + 1; total++; } });
    Object.entries(per).forEach(([d, count]) => {
      const quota = 0.5 * eff * (count / total);
      let got = 0;
      for (const o of options) {
        if (got >= quota) break;
        if (o.h.district === d && take(o)) got += o.p.cost_per_household;
      }
    });
  }
  options.forEach(take);
  const picked = [...chosen.values()];

  const households = picked
    .map((o) => ({
      hhid: o.h.hhid, district_code: o.h.code, district: o.h.district, predicted_spending: o.h.guess,
      p_poor: Math.round(o.h.pPoor * 100) / 100, program_id: o.p.id, program: o.p.name, amount: o.p.cost_per_household,
    }))
    .sort((a, b) => a.predicted_spending - b.predicted_spending);

  const by_program = active
    .map((p) => {
      const list = picked.filter((o) => o.p.id === p.id);
      return { program_id: p.id, program: p.name, households: list.length, money: list.length * p.cost_per_household };
    })
    .sort((a, b) => b.money - a.money);

  const dist = {};
  scored.forEach((h) => {
    if (!h.district) return;
    dist[h.district] ||= { district_code: h.code, district: h.district, households_scanned: 0, households_chosen: 0, money: 0 };
    dist[h.district].households_scanned++;
  });
  picked.forEach((o) => {
    if (!o.h.district) return;
    dist[o.h.district].households_chosen++;
    dist[o.h.district].money += o.p.cost_per_household;
  });
  const by_district = Object.values(dist).sort((a, b) => b.money - a.money);

  let measured = null;
  const withReal = scored.filter((h) => h.real != null && Number.isFinite(h.real));
  if (parsed.header.includes("sol_jan") && withReal.length) {
    const gapOf = (h) => Math.max(0, POVERTY_LINE - h.real);
    const totalReal = withReal.reduce((s, h) => s + gapOf(h), 0);
    const closed = picked.filter((o) => o.h.real != null).reduce((s, o) => s + Math.min(o.p.cost_per_household, gapOf(o.h)), 0);
    const poorReal = withReal.filter((h) => h.real < POVERTY_LINE);
    const extreme = withReal.filter((h) => h.real < EXTREME_LINE);
    const chosenReal = picked.filter((o) => o.h.real != null);
    measured = {
      poverty_gap_closed_pct: r1(totalReal ? (closed / totalReal) * 100 : 0),
      poor_households_reached_pct: r1(poorReal.length ? (poorReal.filter((h) => chosen.has(h.hhid)).length / poorReal.length) * 100 : 0),
      extremely_poor_reached_pct: r1(extreme.length ? (extreme.filter((h) => chosen.has(h.hhid)).length / extreme.length) * 100 : 0),
      helped_not_poor_pct: r1(chosenReal.length ? (chosenReal.filter((o) => o.h.real >= POVERTY_LINE).length / chosenReal.length) * 100 : 0),
    };
  }

  const warnings = v.checks.filter((c) => c.status === "warning").map((c) => ({ code: c.code, message: c.message }));
  const scan_id = Math.random().toString(16).slice(2, 10);
  const response = {
    scan_id,
    created_at: new Date().toISOString(),
    inputs: { file_name: file.name, rows: parsed.rows.length, budget: Number(budget), programs, fair: !!fair },
    warnings,
    summary: {
      households_scanned: scored.length,
      households_chosen: picked.length,
      share_chosen_pct: r1((picked.length / scored.length) * 100),
      budget: Number(budget),
      budget_used: spent,
      expected_poor_households: Math.round(scored.reduce((s, h) => s + h.pPoor, 0)),
      expected_poverty_gap_closed_pct: r1(totalGap ? (picked.reduce((s, o) => s + o.benefit, 0) / totalGap) * 100 : 0),
      measured,
    },
    by_program,
    by_district,
    households,
  };
  SCANS.set(scan_id, { response, byId: new Map(scored.map((h) => [h.hhid, h])), chosen });
  return response;
}

/* ---------------------------- other endpoints ---------------------------- */

function householdInfo(hhid, scanId) {
  const id = Number(hhid);
  let row;
  let decision = null;
  let trueSpending = null;
  if (scanId) {
    const s = SCANS.get(scanId);
    if (!s) throw new ApiError("NOT_FOUND", "Scan not found. The backend may have been restarted.", [], 404);
    const h = s.byId.get(id);
    if (!h) throw new ApiError("NOT_FOUND", `Household ${hhid} is not in this scan.`, [], 404);
    row = h.row;
    trueSpending = h.real;
    const c = s.chosen.get(id);
    decision = c ? { chosen: true, program: c.p.name, amount: c.p.cost_per_household } : { chosen: false, program: null, amount: 0 };
  } else {
    row = survey().rows.find((r) => r.hhid === id);
    if (!row) throw new ApiError("NOT_FOUND", `Household ${hhid} was not found in the survey data.`, [], 404);
    trueSpending = row.sol_jan ?? null;
  }
  const { guess, effects } = predict(row);
  const rows = effects.map((x) => ({ clue: x.key, label: x.label, value: x.value, effect_pct: pct(x.e) })).filter((x) => x.effect_pct !== 0);
  return {
    hhid: id,
    district: row.district || "",
    typical_spending: TYPICAL_SPENDING,
    poverty_line: POVERTY_LINE,
    predicted_spending: guess,
    true_spending: trueSpending != null && Number.isFinite(Number(trueSpending)) ? Number(trueSpending) : null,
    p_poor: Math.round(normCdf(Math.log(POVERTY_LINE / guess) / MODEL_ERROR) * 100) / 100,
    decision,
    pushed_down: rows.filter((x) => x.effect_pct < 0).sort((a, b) => a.effect_pct - b.effect_pct).slice(0, 5),
    pushed_up: rows.filter((x) => x.effect_pct > 0).sort((a, b) => b.effect_pct - a.effect_pct).slice(0, 5),
  };
}

const overviewData = () => ({
  survey: { households: SURVEY_HOUSEHOLDS, people: 62110, districts: 30 },
  poverty: { people_poor_pct: 27.4, people_extreme_pct: 5.4, poverty_line: POVERTY_LINE, extreme_line: EXTREME_LINE },
  model: { name: "LightGBM", r2: 0.69, poor_found_same_size_pick_pct: 60.5 },
  by_province: [
    { province: "Western", households_poor_pct: 31.9 },
    { province: "Southern", households_poor_pct: 30.2 },
    { province: "Eastern", households_poor_pct: 22.6 },
    { province: "Northern", households_poor_pct: 17.5 },
    { province: "Kigali City", households_poor_pct: 6.6 },
  ],
  districts: Object.entries(DISTRICT_LAYOUT)
    .map(([c, d]) => ({ district_code: Number(c), district: d.name, households_poor_pct: POOR[c] }))
    .sort((a, b) => b.households_poor_pct - a.households_poor_pct),
  strategies: {
    budget: DEFAULT_BUDGET,
    items: [
      { id: "S0", name: "Even spread", gap_closed_pct: 3.1, kind: "strategy" },
      { id: "S5", name: "Today's VUP pattern", gap_closed_pct: 4.2, kind: "benchmark" },
      { id: "S1", name: "Poorest first (by prediction)", gap_closed_pct: 10.2, kind: "strategy" },
      { id: "S2", name: "Optimized", gap_closed_pct: 10.5, kind: "strategy" },
      { id: "S3", name: "Optimized and fair", gap_closed_pct: 10.4, kind: "recommended" },
      { id: "S4", name: "Perfect knowledge (best possible)", gap_closed_pct: 14.6, kind: "benchmark" },
    ],
  },
});

function fairnessData() {
  const g = (type, group, households, poor, helped, leak, review) => ({
    type, group, households, poor_pct: poor, poor_helped_pct: helped, helped_not_poor_pct: leak, status: review ? "review" : "ok",
  });
  const rand = rng(11);
  const districts = Object.entries(DISTRICT_LAYOUT).map(([c, d]) => {
    const poor = POOR[c];
    const helped = r1(Math.max(2, poor * (0.7 + rand() * 1.0)));
    const leak = r1(15 + rand() * 25);
    const kirehe = d.name === "Kirehe";
    return {
      district_code: Number(c), district: d.name, households: Math.round(350 + rand() * 300),
      poor_pct: kirehe ? 11.7 : poor, poor_helped_pct: kirehe ? 5.3 : helped, helped_not_poor_pct: kirehe ? 80.0 : leak,
      status: kirehe || leak > 40 ? "review" : "ok",
    };
  });
  return {
    groups: [
      g("City or countryside", "Rural", 11980, 27.6, 32.4, 27.1),
      g("City or countryside", "Urban", 3074, 13.3, 24.4, 23.5),
      g("Province", "Western", 2980, 31.9, 36.6, 23.6),
      g("Province", "Southern", 3120, 30.2, 40.0, 23.6),
      g("Province", "Eastern", 3330, 22.6, 22.9, 32.0),
      g("Province", "Northern", 2430, 17.5, 13.6, 44.8, true),
      g("Province", "Kigali City", 3194, 6.6, 13.4, 34.6),
      g("Sex of household head", "Man", 10560, 23.8, 32.7, 27.5),
      g("Sex of household head", "Woman", 4494, 23.8, 27.2, 23.8, true),
      g("Disability in the household", "Member with serious disability", 1850, 35.8, 38.9, 21.5),
    ],
    districts: districts.sort((a, b) => b.poor_pct - a.poor_pct),
    top_clues: ["Household size", "District", "People per room", "Floor material", "Owns an electric iron"],
  };
}

/* -------------------------------- API -------------------------------- */

export const mockApi = {
  kind: "demo",
  async health() { return { status: "ok", model_loaded: true }; },
  async schema() {
    await sleep(120);
    return {
      default_budget: DEFAULT_BUDGET,
      max_rows: MAX_ROWS,
      programs: PROGRAMS,
      required_columns: REQUIRED.map(([name, label, type]) => ({ name, label, type })),
      optional_columns: [{ name: "sol_jan", label: "Real spending per adult per year (Rwf)", type: "number" }],
    };
  },
  async downloadSample(withSpending = false) {
    const s = generateSample(1000, withSpending);
    saveBlob(csvBlob(toCSV(s.header, s.rows)), "households_sample.csv");
  },
  async validate(file) {
    await sleep(250);
    return checkFile(await readCsv(file), file.name);
  },
  scan: runScan,
  async downloadScanCsv(scanId) {
    const s = SCANS.get(scanId);
    if (!s) throw new ApiError("NOT_FOUND", "Scan not found. The backend may have been restarted.", [], 404);
    const header = ["hhid", "district", "predicted_spending", "p_poor", "program", "amount"];
    saveBlob(csvBlob(toCSV(header, s.response.households)), `scan_${scanId}.csv`);
  },
  async overview() { await sleep(200); return overviewData(); },
  async household(hhid, scanId) { await sleep(150); return householdInfo(hhid, scanId); },
  async fairness() { await sleep(200); return fairnessData(); },
};
