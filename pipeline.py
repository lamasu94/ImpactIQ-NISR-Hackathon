
import json
import warnings
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import pulp
from scipy.stats import norm

warnings.filterwarnings("ignore")

HERE = Path(__file__).parent
OUT = HERE / "output"

POVERTY_LINE, EXTREME_LINE = 560127, 356432
SIGMA = 0.34                      # typical model error in log spending (out-of-fold RMSE)
MAX_ROWS = 5000
FAIR_SHARE = 0.5                  # each district must get at least 50% of its "fair" share of the money
SOLVER_SECONDS = 60

PROGRAMS = {
    "direct_support": {"name": "Direct Support", "cost": 128572},
    "classic_pw": {"name": "Classic Public Works", "cost": 87994},
    "expanded_pw": {"name": "Expanded Public Works", "cost": 149422},
}
NSDS_YEAR = 31128 * 4             # only used to cost today's VUP pattern (the default budget)

BANNED = {
    "quintile", "pov_jan", "poverty", "epov_jan", "strata_id", "food", "Food_at_school", "cons1", "cons1ae",
    "hh_index", "Poverty_line", "Extreme_line", "sol_jan_real", "ed_foodgov", "s4bq2", "s5bq1", "s5bq2a",
    "s5bq3a", "s5bq4", "s5bq5a", "s5cq9a", "s5cq9b", "s5cq11", "s5cq12", "s5cq20", "s5fq8", "s6bq9a",
    "s6bq9b", "s5bq8", "s10bq5a", "s10bq5b", "s10bq5c",
} | {f"exp{i}" for i in range(1, 12)} | {f"s4aq14{c}" for c in "abcdefgh"}


class ApiError(Exception):
    """An error the API turns into the standard error answer."""
    def __init__(self, code, message, details=None, status=400):
        super().__init__(message)
        self.code, self.message, self.details, self.status = code, message, details, status


# ------------------------------------------------------------------------------ plain-English names
ITEMS = {1: "living room suite", 2: "dining table", 3: "beds", 4: "mattresses", 5: "table", 6: "chairs", 7: "bench",
         8: "car", 9: "motorcycle", 10: "bicycle", 11: "solar lamp", 12: "refrigerator", 13: "electric/gas cooker",
         14: "washing machine", 15: "electric iron", 16: "microwave", 17: "blender", 18: "water dispenser",
         19: "basic mobile phone", 20: "smartphone", 21: "computer", 22: "tablet", 23: "television", 24: "radio",
         25: "home theater/sound player", 26: "camera", 27: "garden tractor"}
SERVICES = {1: "clean water source", 2: "food market/shop", 3: "market for farm produce", 4: "public transport stage",
            5: "all-weather road", 6: "pre-primary school", 7: "primary school", 8: "secondary school",
            9: "district hospital", 10: "health centre", 11: "health post", 12: "sector office", 13: "cellule office",
            14: "internet services", 15: "secretarial services"}
PLAIN = {
    "province": "Province", "district": "District", "ur": "City or countryside", "member": "Household size",
    "s5aq1": "Type of settlement", "s5aq2": "Type of dwelling", "s5aq3": "Number of sleeping rooms",
    "s5aq7": "Who owns the dwelling", "s5cq1": "Main water source", "s5cq3": "Main drinking water source",
    "s5cq14": "Electricity connection", "s5cq16": "Main lighting source", "s5cq21": "Type of cook stove",
    "s5cq22a": "Main cooking fuel", "s5cq25": "Type of toilet", "s5cq26": "Toilet shared with another household",
    "s5dq1": "Wall material", "s5dq2": "Roof material", "s5dq3": "Floor material", "s5dq4": "Floor area",
    "s5eq1": "Bad event in last 12 months", "s5eq2a": "Worst bad event", "s5eq4a": "Months to recover from bad event",
    "s7aq4a": "Cattle owned", "s7aq4b": "Goats owned", "s7aq4c": "Sheep owned", "s7aq4d": "Pigs owned",
    "s7aq4e": "Poultry owned", "s7aq4f": "Other animals owned",
    "head_age": "Age of household head", "head_female": "Head is a woman", "head_marital": "Marital status of head",
    "head_school": "School level of head", "head_can_read": "Head can read",
    "n_children": "Number of children (under 15)", "n_elderly": "Number of elderly (65+)",
    "share_female": "Share of members who are women", "max_school": "Highest school level in the household",
    "n_can_read": "Members who can read", "n_can_write": "Members who can write",
    "n_can_calc": "Members who can calculate", "n_insured": "Members with health insurance",
    "n_disabled": "Members with a serious disability", "n_phone": "Members with a mobile phone",
    "any_smartphone": "Someone has a smartphone", "any_computer": "Someone has a computer",
    "any_internet": "Someone uses the internet", "n_item_types": "Number of different belongings owned",
    "n_items_total": "Total belongings owned", "has_account": "Has a bank or mobile money account",
    "has_bank_or_momo": "Has a bank or mobile money account", "in_tontine": "Member of a tontine",
    "tried_loan": "Tried to get a loan", "owes_money": "Owes money", "minutes_mean": "Average minutes to services",
    "people_per_room": "People per sleeping room", "children_per_member": "Share of members who are children",
    "share_can_read": "Share of members who can read",
    "hhid": "Household ID", "ae": "Adult equivalents", "sol_jan": "Real spending per adult per year (Rwf)",
}
for _k, _v in ITEMS.items():
    PLAIN[f"owns_item_{_k:02d}"] = f"Owns: {_v}"
for _k, _v in SERVICES.items():
    PLAIN[f"minutes_to_service_{_k:02d}"] = f"Minutes to {_v}"
YES_NO = {"head_female", "head_can_read", "any_smartphone", "any_computer", "any_internet", "has_account",
          "has_bank_or_momo", "in_tontine", "tried_loan", "owes_money"} | {f"owns_item_{k:02d}" for k in ITEMS}


# ------------------------------------------------------------------------------ loading the assets once
class _Assets:
    loaded = False


A = _Assets()


def load():
    """Load the model and the saved result files. Safe to call many times."""
    if A.loaded:
        return A
    bundle = joblib.load(OUT / "lightgbm_model.joblib")
    A.model, A.clues, A.cats = bundle["model"], bundle["clues"], bundle["categorical"]
    A.feature_list = pd.read_csv(OUT / "feature_list.csv")
    A.value_labels = {c: {int(k): v for k, v in d.items()}
                      for c, d in json.load(open(HERE / "value_labels.json")).items()}
    A.districts = {int(k): v for k, v in A.value_labels["district"].items()}
    A.district_codes = {v: k for k, v in A.districts.items()}
    A.survey = pd.read_csv(OUT / "model_table.csv")
    A.optimizer = pd.read_csv(OUT / "optimizer_table.csv")
    A.explainer = None
    A.loaded = True
    return A


def _label(col):
    return PLAIN.get(col, col)


def _show_value(col, v):
    a = load()
    if v is None or (isinstance(v, float) and np.isnan(v)):
        return "not known"
    if col in YES_NO:
        return "yes" if float(v) == 1 else "no"
    if col in a.value_labels and int(v) in a.value_labels[col]:
        return a.value_labels[col][int(v)]
    if col == "s5eq2a" and int(v) == 0:
        return "no bad event"
    return f"{float(v):.2f}".rstrip("0").rstrip(".")


# ------------------------------------------------------------------------------ 1. schema, sample, validation
def default_budget():
    o = load().optimizer
    cost = (o.gets_direct_support * PROGRAMS["direct_support"]["cost"] + o.gets_classic_pw * PROGRAMS["classic_pw"]["cost"]
            + o.gets_expanded_pw * PROGRAMS["expanded_pw"]["cost"] + o.gets_nsds * NSDS_YEAR)
    return int(cost.sum())


def schema():
    a = load()
    types = dict(zip(a.feature_list.column, a.feature_list.type))
    required = [{"name": "hhid", "label": _label("hhid"), "type": "number"},
                {"name": "ae", "label": _label("ae"), "type": "number"}]
    required += [{"name": c, "label": _label(c), "type": types.get(c, "number")} for c in a.clues]
    return {
        "default_budget": default_budget(),
        "default_budget_per_household": round(default_budget() / len(a.optimizer)),
        "max_rows": MAX_ROWS,
        "programs": [{"id": k, "name": v["name"], "cost_per_household": v["cost"]} for k, v in PROGRAMS.items()],
        "required_columns": required,
        "optional_columns": [{"name": "sol_jan", "label": _label("sol_jan"), "type": "number"}],
    }


def sample_file(with_spending=False, n=1000, seed=7):
    """A CSV of survey households in the upload format."""
    a = load()
    s = a.survey.sample(n=min(n, len(a.survey)), random_state=seed)
    cols = ["hhid", "ae"] + a.clues + (["sol_jan"] if with_spending else [])
    return s[cols].to_csv(index=False)


def validate(df, file_name="upload.csv"):
    """Check an uploaded table. Returns {ok, checks, ...}. Never raises for a bad file."""
    a = load()
    checks = []
    fail = lambda code, msg, details=None: checks.append(
        {"status": "fail", "code": code, "message": msg, **({"details": details} if details else {})})
    ok_ = lambda code, msg: checks.append({"status": "pass", "code": code, "message": msg})

    need = ["hhid", "ae"] + a.clues
    missing = [c for c in need if c not in df.columns]
    if missing:
        fail("MISSING_COLUMNS", f"The file is missing {len(missing)} required columns.", missing)
    else:
        ok_("COLUMNS_OK", f"All {len(a.clues)} clue columns found")
    banned = sorted(set(df.columns) & BANNED)
    if banned:
        fail("BANNED_COLUMNS", "The file contains spending or poverty columns that are not allowed.", banned)
    else:
        ok_("NO_BANNED", "No banned columns (spending, poverty codes) in the file")
    if len(df) > MAX_ROWS:
        fail("TOO_MANY_ROWS", f"The file has {len(df):,} rows. The maximum is {MAX_ROWS:,}.")
    if "hhid" in df.columns:
        if df.hhid.duplicated().any():
            fail("DUPLICATE_HHID", f"{int(df.hhid.duplicated().sum())} households share an ID with another row.")
        else:
            ok_("HHID_UNIQUE", "Every household has a unique ID")
    if "ae" in df.columns:
        ae = pd.to_numeric(df.ae, errors="coerce")
        bad = int((ae.isna() | (ae <= 0)).sum())
        if bad:
            fail("BAD_AE", f"{bad} households have a missing or zero value in 'ae' (adult equivalents).")
    if "district" in df.columns:
        n_empty = int(pd.to_numeric(df.district, errors="coerce").isna().sum())
        if n_empty:
            checks.append({"status": "warning", "code": "EMPTY_DISTRICT",
                           "message": f"{n_empty} households have an empty district. They will still be scanned, "
                                      "but cannot count towards a district's fair share."})
    if "sol_jan" not in df.columns:
        checks.append({"status": "info", "code": "NO_SPENDING",
                       "message": "No real spending column found. Results will be estimates only."})
    if "hhid" in df.columns and len(df):
        share = df.hhid.isin(a.survey.hhid).mean()
        if share > 0.5:
            checks.append({"status": "warning", "code": "TRAINING_DATA",
                           "message": "Most households in this file are survey households the model was trained on. "
                                      "Measured results will look better than they would on new data."})
    return {"ok": not any(c["status"] == "fail" for c in checks), "file_name": file_name,
            "rows": int(len(df)), "columns": int(df.shape[1]), "checks": checks}


def _check_or_raise(df):
    v = validate(df)
    bad = [c for c in v["checks"] if c["status"] == "fail"]
    if bad:
        c = bad[0]
        raise ApiError(c["code"], c["message"], c.get("details"))
    return v


# ------------------------------------------------------------------------------ 2. prediction
def _model_input(df):
    a = load()
    X = df[a.clues].apply(pd.to_numeric, errors="coerce").copy()
    for c in a.cats:
        X[c] = X[c].astype(float).astype("category")      # LightGBM re-maps these to the training categories
    return X


def predict_log(df):
    """The model's guess of log(spending per adult per year) for each household."""
    return load().model.predict(_model_input(df))


def _G(K, mu):
    """Expected shortfall below K, when spending is lognormal around the model's guess."""
    K = np.maximum(K, 1e-9)
    d = (np.log(K) - mu) / SIGMA
    return K * norm.cdf(d) - np.exp(mu + SIGMA ** 2 / 2) * norm.cdf(d - SIGMA)


def expected_benefit(mu, ae, cost):
    """Expected poverty gap (Rwf per year) closed if a household receives a transfer of `cost`."""
    t = cost / ae
    return ae * (_G(np.full(len(mu), float(POVERTY_LINE)), mu) - np.where(POVERTY_LINE - t > 0, _G(POVERTY_LINE - t, mu), 0.0))


# ------------------------------------------------------------------------------ 3. allocation
def _solve(df, mu, ae, budget, program_ids, fair):
    """Choose a program for each household. Returns (chosen program id or None per household, solver note)."""
    n = len(df)
    p_ext = norm.cdf((np.log(EXTREME_LINE) - mu) / SIGMA)
    p_poor = norm.cdf((np.log(POVERTY_LINE) - mu) / SIGMA)
    priority = 1 + p_ext
    benefit = {p: expected_benefit(mu, ae, PROGRAMS[p]["cost"]) for p in program_ids}
    cand = [int(i) for i in range(n) if max(benefit[p][i] for p in program_ids) > 1.0]
    district = pd.to_numeric(df["district"], errors="coerce").values
    max_cost = max(PROGRAMS[p]["cost"] for p in program_ids)

    def run(use_fair):
        prob = pulp.LpProblem("alloc", pulp.LpMaximize)
        x = {(i, p): pulp.LpVariable(f"x_{i}_{j}", cat="Binary") for i in cand for j, p in enumerate(program_ids)}
        prob += pulp.lpSum(float(priority[i] * benefit[p][i]) * x[i, p] for (i, p) in x)
        prob += pulp.lpSum(float(PROGRAMS[p]["cost"]) * x[i, p] for (i, p) in x) <= float(budget)
        for i in cand:
            prob += pulp.lpSum(x[i, p] for p in program_ids) <= 1
        if use_fair:
            share = pd.Series(p_poor).groupby(district).sum()
            share = share / share.sum() if share.sum() > 0 else share
            for d, s in share.items():
                members = [i for i in cand if district[i] == d]
                absorb = 0.9 * max_cost * len(members)
                floor = min(FAIR_SHARE * s * budget, absorb)
                if members and floor > 0:
                    prob += pulp.lpSum(float(PROGRAMS[p]["cost"]) * x[i, p] for i in members for p in program_ids) >= float(floor)
        prob.solve(pulp.PULP_CBC_CMD(msg=0, timeLimit=SOLVER_SECONDS, gapRel=0.001))
        return pulp.LpStatus[prob.status], x

    note = None
    status, x = run(fair)
    if fair and status != "Optimal":
        status, x = run(False)
        note = "FAIR_RELAXED"
    if status not in ("Optimal", "Not Solved"):
        raise ApiError("SERVER_ERROR", f"The optimizer could not find a solution (status: {status}).", status=500)
    chosen = [None] * n
    for (i, p), v in x.items():
        if v.value() is not None and v.value() > 0.5:
            chosen[i] = p
    return chosen, note, benefit, p_poor


def scan(df, budget, program_ids, fair, file_name="upload.csv"):
    """Predict, allocate and summarise. Returns (answer for /scan, table for later explanations)."""
    a = load()
    try:
        budget = float(budget)
    except (TypeError, ValueError):
        budget = 0
    if budget <= 0:
        raise ApiError("BAD_BUDGET", "Budget must be a number above zero.")
    program_ids = [p for p in program_ids if p in PROGRAMS]
    if not program_ids:
        raise ApiError("NO_PROGRAMS", "Choose at least one program.")
    v = _check_or_raise(df)
    df = df.reset_index(drop=True).copy()
    mu = predict_log(df)
    ae = pd.to_numeric(df.ae).values.astype(float)

    chosen, note, benefit, p_poor = _solve(df, mu, ae, budget, program_ids, fair)
    pred = np.exp(mu)
    district = pd.to_numeric(df["district"], errors="coerce")
    cost = np.array([PROGRAMS[p]["cost"] if p else 0 for p in chosen], dtype=float)
    got = cost > 0
    exp_closed = sum(benefit[p][i] for i, p in enumerate(chosen) if p)
    exp_total = (ae * _G(np.full(len(df), float(POVERTY_LINE)), mu)).sum()

    warnings_ = [{"code": c["code"], "message": c["message"]} for c in v["checks"] if c["status"] == "warning"]
    if note == "FAIR_RELAXED":
        warnings_.append({"code": "FAIR_RELAXED", "message": "The fair-share rule could not be met with this budget and file, so the plan was made without it."})

    measured = None
    if "sol_jan" in df.columns:
        spend = pd.to_numeric(df.sol_jan, errors="coerce").values
        if not np.isnan(spend).all():
            gap = np.maximum(0, POVERTY_LINE - spend) * ae
            poor = spend < POVERTY_LINE
            ext = spend < EXTREME_LINE
            measured = {
                "poverty_gap_closed_pct": round(100 * np.minimum(cost, gap).sum() / max(gap.sum(), 1), 1),
                "poor_households_reached_pct": round(100 * (got & poor).sum() / max(poor.sum(), 1), 1),
                "extremely_poor_reached_pct": round(100 * (got & ext).sum() / max(ext.sum(), 1), 1),
                "helped_not_poor_pct": round(100 * (got & ~poor).sum() / max(got.sum(), 1), 1),
            }

    by_program = []
    for p in program_ids:
        k = sum(1 for c in chosen if c == p)
        by_program.append({"program_id": p, "program": PROGRAMS[p]["name"], "households": k, "money": int(k * PROGRAMS[p]["cost"])})
    by_program.sort(key=lambda r: -r["money"])

    by_district = []
    for d, idx in df.groupby(district).groups.items():
        idx = list(idx)
        by_district.append({"district_code": int(d), "district": a.districts.get(int(d), str(int(d))),
                            "households_scanned": len(idx), "households_chosen": int(got[idx].sum()),
                            "money": int(cost[idx].sum())})
    by_district.sort(key=lambda r: -r["money"])

    rows = []
    for i in np.argsort(pred):
        if not got[i]:
            continue
        d = district.iloc[i]
        rows.append({"hhid": int(df.hhid.iloc[i]), "district_code": None if np.isnan(d) else int(d),
                     "district": a.districts.get(int(d)) if not np.isnan(d) else None,
                     "predicted_spending": int(round(pred[i])), "p_poor": round(float(p_poor[i]), 2),
                     "program_id": chosen[i], "program": PROGRAMS[chosen[i]]["name"], "amount": PROGRAMS[chosen[i]]["cost"]})

    answer = {
        "created_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "inputs": {"file_name": file_name, "rows": int(len(df)), "budget": int(budget), "programs": program_ids, "fair": bool(fair)},
        "warnings": warnings_,
        "summary": {
            "households_scanned": int(len(df)), "households_chosen": int(got.sum()),
            "share_chosen_pct": round(100 * got.mean(), 1), "budget": int(budget), "budget_used": int(cost.sum()),
            "expected_poor_households": int(round(p_poor.sum())),
            "expected_poverty_gap_closed_pct": round(100 * exp_closed / max(exp_total, 1), 1),
            "measured": measured,
        },
        "by_program": by_program, "by_district": by_district, "households": rows,
    }
    table = df.copy()
    table["_chosen"] = chosen
    table["_p_poor"] = p_poor
    return answer, table


def scan_csv(answer):
    cols = ["hhid", "district", "predicted_spending", "p_poor", "program", "amount"]
    return pd.DataFrame(answer["households"])[cols].to_csv(index=False)


# ------------------------------------------------------------------------------ 4. explaining one household
def explain(row_df, decision=None, true_spending=None):
    """row_df: a one-row table in the upload format. Returns the answer for /household/{hhid}."""
    a = load()
    X = _model_input(row_df)
    contrib = a.model.predict(X, pred_contrib=True)[0]   # same numbers as SHAP, built into LightGBM
    sv = contrib[:-1]
    base = float(contrib[-1])
    mu = base + sv.sum()
    eff = [(a.clues[j], float(sv[j])) for j in range(len(a.clues))]

    def item(c, s):
        return {"clue": c, "label": _label(c), "value": _show_value(c, row_df[c].iloc[0]), "effect_pct": int(round(100 * (np.exp(s) - 1)))}
    down = [item(c, s) for c, s in sorted(eff, key=lambda t: t[1]) if s < 0][:5]
    up = [item(c, s) for c, s in sorted(eff, key=lambda t: -t[1]) if s > 0][:5]
    d = pd.to_numeric(row_df["district"], errors="coerce").iloc[0]
    return {
        "hhid": int(row_df.hhid.iloc[0]),
        "district": a.districts.get(int(d)) if not np.isnan(d) else None,
        "typical_spending": int(round(np.exp(base))), "poverty_line": POVERTY_LINE,
        "predicted_spending": int(round(np.exp(mu))),
        "true_spending": None if true_spending is None or np.isnan(true_spending) else int(round(true_spending)),
        "p_poor": round(float(norm.cdf((np.log(POVERTY_LINE) - mu) / SIGMA)), 2),
        "decision": decision, "pushed_down": down, "pushed_up": up,
    }


def survey_row(hhid):
    """One-row table for a surveyed household, in the upload format (plus real spending)."""
    a = load()
    r = a.survey[a.survey.hhid == hhid]
    if r.empty:
        raise ApiError("NOT_FOUND", f"Household {hhid} was not found.", status=404)
    return r[["hhid", "ae"] + a.clues + ["sol_jan"]].reset_index(drop=True)


# ------------------------------------------------------------------------------ 5. overview and fairness (saved results)
STRATEGIES = [("S0", "Even spread", "strategy"), ("S5", "Today's VUP pattern", "benchmark"),
              ("S1", "Poorest first (by prediction)", "strategy"), ("S2", "Optimized", "strategy"),
              ("S3", "Optimized and fair", "recommended"), ("S4", "Perfect knowledge (best possible)", "benchmark")]


def overview():
    a = load()
    o, m = a.optimizer, pd.read_csv(OUT / "model_results.csv")
    lgb = m[m.model.str.startswith("C.")].iloc[0]
    alloc = pd.read_csv(OUT / "allocation_results.csv")
    alloc["id"] = alloc.strategy.str[:2]
    gap = dict(zip(alloc.id, alloc["poverty gap closed (%)"]))
    fg = pd.read_csv(OUT / "fairness_by_group.csv")
    fd = pd.read_csv(OUT / "fairness_by_district.csv")
    w = o.pop_wt
    return {
        "survey": {"households": int(len(o)), "people": int(a.survey.member.sum()), "districts": int(o.district.nunique())},
        "poverty": {"people_poor_pct": float(round(100 * w[o.is_poor == 1].sum() / w.sum(), 1)),
                    "people_extreme_pct": float(round(100 * w[o.is_extremely_poor == 1].sum() / w.sum(), 1)),
                    "poverty_line": POVERTY_LINE, "extreme_line": EXTREME_LINE},
        "model": {"name": "LightGBM", "r2": round(float(lgb["R2 (1 = perfect)"]), 2),
                  "poor_found_same_size_pick_pct": float(lgb["same-size pick: poor found (%)"])},
        "by_province": [{"province": r.group, "households_poor_pct": float(r["share who are poor (%)"])}
                        for _, r in fg[fg.type == "Province"].sort_values("share who are poor (%)", ascending=False).iterrows()],
        "districts": [{"district_code": a.district_codes.get(r.group), "district": r.group,
                       "households_poor_pct": float(r["share who are poor (%)"])}
                      for _, r in fd.sort_values("share who are poor (%)", ascending=False).iterrows()],
        "strategies": {"budget": default_budget(),
                       "items": [{"id": i, "name": n, "gap_closed_pct": float(gap[i]), "kind": k} for i, n, k in STRATEGIES if i in gap]},
    }


def _status(r, overall):
    """'review' if few poor households get help, many helped are not poor, or the group is well below the average."""
    if r.poor_helped_pct < 15 or r.helped_not_poor_pct > 40 or r.poor_helped_pct < 0.9 * overall:
        return "review"
    return "ok"


def fairness():
    a = load()
    fg = pd.read_csv(OUT / "fairness_by_group.csv")
    fd = pd.read_csv(OUT / "fairness_by_district.csv")
    ren = {"share who are poor (%)": "poor_pct", "poor households that get help (%)": "poor_helped_pct",
           "of those helped, not poor (%)": "helped_not_poor_pct"}
    fg, fd = fg.rename(columns=ren), fd.rename(columns=ren)
    alloc = pd.read_csv(OUT / "allocation_results.csv")
    overall = float(alloc[alloc.strategy.str.startswith("S3")]["poor households reached (%)"].iloc[0])
    groups = [{"type": r.type, "group": r.group, "households": int(r.households), "poor_pct": float(r.poor_pct),
               "poor_helped_pct": float(r.poor_helped_pct), "helped_not_poor_pct": float(r.helped_not_poor_pct),
               "status": _status(r, overall)} for _, r in fg.iterrows()]
    districts = [{"district_code": a.district_codes.get(r.group), "district": r.group, "households": int(r.households),
                  "poor_pct": float(r.poor_pct), "poor_helped_pct": float(r.poor_helped_pct),
                  "helped_not_poor_pct": float(r.helped_not_poor_pct), "status": _status(r, overall)}
                 for _, r in fd.iterrows()]
    top = ["Household size", "District", "People per room", "Floor material", "Owns an electric iron"]
    f = OUT / "shap_values.csv"
    if f.exists():
        s = pd.read_csv(f).drop(columns="hhid").abs().mean().sort_values(ascending=False)
        top = [_label(c) for c in s.index[:5]]
    return {"groups": groups, "districts": districts, "top_clues": top}