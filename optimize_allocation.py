
import warnings; warnings.filterwarnings("ignore")
from pathlib import Path
import numpy as np
import pandas as pd
import pulp
from scipy.stats import norm
import matplotlib; matplotlib.use("Agg")
import matplotlib.pyplot as plt

OUT = Path("output")
L, E = 560127, 356432                                  # poverty line, extreme poverty line (Rwf per adult per year)
SIGMA = 0.34                                           # typical model error in log spending (from model_results.csv)
PROGRAMS = {"Direct Support": 128572, "Classic Public Works": 87994, "Expanded Public Works": 149422}  # Rwf per household per year (VUP report)
NSDS_YEAR = 31128 * 4                                  # NSDS pays per quarter; used only to cost today's pattern
FAIR_SHARE = 0.5                                       # each district must get at least 50% of its "fair" share of the money

pred = pd.read_csv(OUT / "predictions.csv")[["hhid", "pred_C"]]
t = pd.read_csv(OUT / "optimizer_table.csv").merge(pred, on="hhid")
n = len(t)
ae = t.ae.values
true_gap = t.true_gap_household.values                 # real shortfall of the household (Rwf per year)
mu = np.log(t.pred_C.values)                           # model's guess (log spending per adult)

# ---------- what we believe about each household (uses only the model's guess, never the true spending)
def G(K):                                              # expected shortfall below K for lognormal spending
    K = np.maximum(K, 1e-9)
    d = (np.log(K) - mu) / SIGMA
    return K * norm.cdf(d) - np.exp(mu + SIGMA**2 / 2) * norm.cdf(d - SIGMA)

exp_benefit = {}
for p, T in PROGRAMS.items():
    tk = T / ae                                        # transfer per adult equivalent
    gain = G(np.full(n, L)) - np.where(L - tk > 0, G(L - tk), 0.0)
    exp_benefit[p] = ae * gain                         # expected poverty gap closed (Rwf)
p_poor = norm.cdf((np.log(L) - mu) / SIGMA)
p_ext = norm.cdf((np.log(E) - mu) / SIGMA)
priority = 1 + p_ext                                   # extremely poor count double

# ---------- the budget = what today's VUP support costs in this sample
today_cost = (t.gets_direct_support * PROGRAMS["Direct Support"] + t.gets_classic_pw * PROGRAMS["Classic Public Works"]
              + t.gets_expanded_pw * PROGRAMS["Expanded Public Works"] + t.gets_nsds * NSDS_YEAR).values
BUDGET = float(today_cost.sum())
print(f"Budget (cost of today's VUP support in the sample): {BUDGET:,.0f} Rwf | households helped today: {(today_cost > 0).sum():,}")

# ---------- the optimizer
def optimize(benefit, fair, label):
    prob = pulp.LpProblem(label, pulp.LpMaximize)
    cand = [int(i) for i in range(n) if max(benefit[p][i] for p in PROGRAMS) > 1.0]
    def new_var(name):                                  # works with old (2.x/3.x) and new (4.x) PuLP
        return prob.add_variable(name, cat="Binary") if hasattr(prob, "add_variable") else pulp.LpVariable(name, cat="Binary")
    x = {(i, p): new_var(f"x_{i}_{j}") for i in cand for j, p in enumerate(PROGRAMS)}
    prob += pulp.lpSum(float(priority[i] * benefit[p][i]) * x[i, p] for (i, p) in x)               # goal
    prob += pulp.lpSum(float(PROGRAMS[p]) * x[i, p] for (i, p) in x) <= BUDGET                     # rule 1: budget
    for i in cand:                                                                          # rule 2: one program each
        prob += pulp.lpSum(x[i, p] for p in PROGRAMS) <= 1
    if fair:                                                                                # rule 3: every district gets its share
        share = pd.Series(p_poor).groupby(t.district.values).sum()
        share = share / share.sum()
        for d, s in share.items():
            members = [i for i in cand if t.district.values[i] == d]
            prob += pulp.lpSum(float(PROGRAMS[p]) * x[i, p] for i in members for p in PROGRAMS) >= float(FAIR_SHARE * s * BUDGET)
    prob.solve(pulp.PULP_CBC_CMD(msg=0, timeLimit=240, gapRel=0.001))
    print(f"  {label}: solver status = {pulp.LpStatus[prob.status]}")
    cost = np.zeros(n)
    for (i, p), v in x.items():
        if v.value() and v.value() > 0.5: cost[i] = PROGRAMS[p]
    return cost

# ---------- the strategies. Each returns "money given to each household".
rng = np.random.RandomState(0)
amount = PROGRAMS["Direct Support"]
k = int(BUDGET // amount)
S = {}
# S0: even spread: same share per district, random households inside (Direct Support amount)
c0 = np.zeros(n); share_d = t.district.value_counts(normalize=True)
for d, s in share_d.items():
    idx = np.where(t.district.values == d)[0]
    c0[rng.choice(idx, min(len(idx), int(round(s * k))), replace=False)] = amount
S["S0 Even spread"] = c0
# S1: poorest predicted first (Direct Support amount)
c1 = np.zeros(n); c1[np.argsort(t.pred_C.values)[:k]] = amount
S["S1 Poorest first (by prediction)"] = c1
# S2 and S3: optimizer
S["S2 Optimized"] = optimize(exp_benefit, False, "S2")
S["S3 Optimized + fair"] = optimize(exp_benefit, True, "S3")
# S4: the optimizer with perfect knowledge (best possible)
perfect = {p: np.minimum(T, true_gap) for p, T in PROGRAMS.items()}
priority_backup = priority.copy(); priority = 1 + (t.sol_jan.values < E).astype(float)
S["S4 Perfect knowledge (benchmark)"] = optimize(perfect, False, "S4")
priority = priority_backup
# S5: what happens today
S["S5 Today's VUP pattern"] = today_cost

# ---------- score every strategy with the TRUE data
poor = t.is_poor.values == 1; ext = t.is_extremely_poor.values == 1
total_gap = true_gap.sum()
rows = []
for name, c in S.items():
    got = c > 0
    gap_closed = np.minimum(c, true_gap).sum()
    lifted = poor & got & ((t.sol_jan.values * ae + c) / ae >= L)
    dist_cov = pd.Series(got & poor).groupby(t.district.values).sum() / pd.Series(poor).groupby(t.district.values).sum()
    rows.append({
        "strategy": name, "households helped": int(got.sum()), "money spent (Rwf m)": round(c.sum() / 1e6, 1),
        "poverty gap closed (%)": round(100 * gap_closed / total_gap, 1),
        "money that reached the gap (%)": round(100 * gap_closed / c.sum(), 1),
        "poor households reached (%)": round(100 * (got & poor).sum() / poor.sum(), 1),
        "extremely poor reached (%)": round(100 * (got & ext).sum() / ext.sum(), 1),
        "helped who are not poor (%)": round(100 * (got & ~poor).sum() / got.sum(), 1),
        "poor lifted over the line": int(lifted.sum()),
        "worst district: poor reached (%)": round(100 * dist_cov.min(), 1),
    })
res = pd.DataFrame(rows)
pd.set_option("display.width", 250); pd.set_option("display.max_columns", 30)
print("\n" + res.T.to_string(header=False))
res.to_csv(OUT / "allocation_results.csv", index=False)

fair = t[["hhid", "district", "province", "ur"]].copy()
cf = S["S3 Optimized + fair"]; fair["money_given"] = cf
fair["program"] = pd.Series(cf).map({v: k for k, v in PROGRAMS.items()}).fillna("none")
fair[cf > 0].to_csv(OUT / "allocation_fair.csv", index=False)

plt.figure(figsize=(9, 4.5)); order = res.set_index("strategy")["poverty gap closed (%)"]
plt.barh(order.index[::-1], order.values[::-1], color=["#7F7F7F" if "Perfect" in s or "Today" in s else "#1F4E79" for s in order.index[::-1]])
plt.xlabel("Share of the national poverty gap closed (same budget for every strategy)"); plt.tight_layout()
plt.savefig(OUT / "allocation_results.png", dpi=150)
print("\nSaved: allocation_results.csv, allocation_fair.csv, allocation_results.png")