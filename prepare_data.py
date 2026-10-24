from pathlib import Path
import numpy as np
import pandas as pd

IN = Path("data_csv")
OUT = Path("output")
OUT.mkdir(exist_ok=True)

POVERTY_LINE, EXTREME_LINE = 560127, 356432
BANNED = {  
    "quintile", "pov_jan", "poverty", "epov_jan", "strata_id", "food", "Food_at_school",
    "cons1", "cons1ae", "hh_index", "Poverty_line", "Extreme_line", "sol_jan",
    "ed_foodgov", "s4bq2", "s5bq1", "s5bq2a", "s5bq3a", "s5bq4", "s5bq5a", "s5cq9a", "s5cq9b",
    "s5cq11", "s5cq12", "s5cq20", "s5fq8", "s6bq9a", "s6bq9b", "s5bq8",
    "s10bq5a", "s10bq5b", "s10bq5c",
} | {f"exp{i}" for i in range(1, 12)} | {f"s4aq14{c}" for c in "abcdefgh"}


def read(name, cols=None):
    return pd.read_csv(IN / f"{name}.csv", usecols=cols, low_memory=False)


def to_h(df):  # make hhid a clean integer
    df["hhid"] = df["hhid"].astype("int64")
    return df


groups = {}  # feature name -> (group, type)
def register(cols, group, kind):
    for c in cols:
        groups[c] = (group, kind)


# 1. poverty file
pov = to_h(read("1_poverty_file"))
base = pov[["hhid", "clust", "weight", "pop_wt", "ae", "sol_jan"]].copy()
base["clust"] = base["clust"].astype("int64")
feat = pov[["hhid", "province", "district", "ur", "member"]].copy()
register(["province", "district", "ur"], "Place", "category")
register(["member"], "Household makeup", "number")

#  2. household file
H_CAT = ["s5aq1", "s5aq2", "s5aq7", "s5dq1", "s5dq2", "s5dq3", "s5dq4", "s5cq1", "s5cq3", "s5cq14",
         "s5cq16", "s5cq21", "s5cq22a", "s5cq25", "s5cq26", "s5eq1", "s5eq2a"]
H_NUM = ["s5aq3", "s7aq4a", "s7aq4b", "s7aq4c", "s7aq4d", "s7aq4e", "s7aq4f", "s5eq4a"]
hh = to_h(read("2_household_file", ["hhid"] + H_CAT + H_NUM))

animals = [c for c in H_NUM if c.startswith("s7aq4")]
hh[animals] = hh[animals].fillna(0)                 
hh[["s5eq2a", "s5eq4a"]] = hh[["s5eq2a", "s5eq4a"]].fillna(0) 
register(H_CAT[:7], "House", "category"); register(["s5aq3"], "House", "number")
register(H_CAT[7:14], "Water, power, toilet", "category")
register(H_CAT[14:15], "Water, power, toilet", "category")
register(["s5cq25", "s5cq26"], "Water, power, toilet", "category")
register(animals, "Animals", "number")
register(["s5eq1", "s5eq2a"], "Bad events", "category"); register(["s5eq4a"], "Bad events", "number")
feat = feat.merge(hh, on="hhid", how="left")

#  3. person file -> one row per household
P = ["hhid", "s1q1", "s1q2", "s1q3y", "s1q4", "s4aq2", "s4bq4", "s4bq6", "s4bq7", "s3q2",
     "s3q7", "s3q8", "s3q9", "s3q10", "s3q11", "s3q12", "s4bq8", "s4bq10", "s4bq13a", "s4bq15"]
per = to_h(read("3_person_file", P))
per["child"] = per.s1q3y < 15
per["elder"] = per.s1q3y >= 65
per["female"] = per.s1q1 == 2
per["school"] = per.s4aq2.fillna(0)           # 0 = no schooling recorded
per["can_read"] = per.s4bq4 == 1
per["can_write"] = per.s4bq6 == 1
per["can_calc"] = per.s4bq7 == 1
per["insured"] = per.s3q2 == 1
dis = per[["s3q7", "s3q8", "s3q9", "s3q10", "s3q11", "s3q12"]]
per["disabled"] = (dis >= 3).any(axis=1)      # "a lot of difficulty" or worse in any area
per["has_phone"] = per.s4bq8 == 1
per["smartphone"] = per.s4bq10.isin([2, 3])
per["computer"] = per.s4bq13a == 1
per["internet"] = per.s4bq15 == 1

g = per.groupby("hhid")
agg = pd.DataFrame({
    "n_children": g.child.sum(), "n_elderly": g.elder.sum(),
    "share_female": g.female.mean(), "max_school": g.school.max(),
    "n_can_read": g.can_read.sum(), "n_can_write": g.can_write.sum(), "n_can_calc": g.can_calc.sum(),
    "n_insured": g.insured.sum(), "n_disabled": g.disabled.sum(),
    "n_phone": g.has_phone.sum(), "any_smartphone": g.smartphone.max().astype(int),
    "any_computer": g.computer.max().astype(int), "any_internet": g.internet.max().astype(int),
})
head = per[per.s1q2 == 1].drop_duplicates("hhid").set_index("hhid")
agg["head_age"] = head.s1q3y
agg["head_female"] = (head.s1q1 == 2).astype(int)
agg["head_marital"] = head.s1q4
agg["head_school"] = head.school
agg["head_can_read"] = (head.s4bq4 == 1).astype(int)
agg = agg.reset_index()
register(["head_marital"], "Household makeup", "category")
register(["head_age", "head_female", "head_school", "head_can_read", "n_children", "n_elderly", "share_female"],
         "Household makeup", "number")
register(["max_school", "n_can_read", "n_can_write", "n_can_calc"], "Education", "number")
register(["n_insured", "n_disabled"], "Health", "number")
register(["n_phone", "any_smartphone", "any_computer", "any_internet"], "Phone and internet", "number")
feat = feat.merge(agg, on="hhid", how="left")

#  4. belongings (27 items)
d = to_h(read("4_durables_file", ["hhid", "s10bq0", "s10bq2"]))
d["owns"] = (d.s10bq2 > 0).astype(int)
own = d.pivot_table(index="hhid", columns="s10bq0", values="owns", aggfunc="max")
own.columns = [f"owns_item_{int(c):02d}" for c in own.columns]
own["n_item_types"] = own.sum(axis=1)
own["n_items_total"] = d.groupby("hhid").s10bq2.sum()
own = own.reset_index()
register([c for c in own.columns if c.startswith("owns_item")], "Belongings", "number")
register(["n_item_types", "n_items_total"], "Belongings", "number")
feat = feat.merge(own, on="hhid", how="left")

#  5. savings and loans
s = to_h(read("5_savings_file", ["hhid", "s10cq1", "s10cq4", "s10cq8"]))
sav = s.groupby("hhid").agg(
    has_account=("s10cq1", lambda x: int((x == 1).any())),
    has_bank_or_momo=("s10cq4", lambda x: int((x == 1).any())),
    in_tontine=("s10cq8", lambda x: int((x == 1).any())),
).reset_index()
lo = to_h(read("7_loans_file", ["hhid", "s10aq1", "s10aq3"]))
loan = lo.groupby("hhid").agg(
    tried_loan=("s10aq1", lambda x: int((x == 1).any())),
    owes_money=("s10aq3", lambda x: int((x == 1).any())),
).reset_index()
register(["has_account", "has_bank_or_momo", "in_tontine"], "Savings and loans", "number")
register(["tried_loan", "owes_money"], "Savings and loans", "number")
feat = feat.merge(sav, on="hhid", how="left").merge(loan, on="hhid", how="left")
for c in ["has_account", "has_bank_or_momo", "in_tontine", "tried_loan", "owes_money"]:
    feat[c] = feat[c].fillna(0).astype(int)      # household not in that file = no account / no loan

#  6. distance to 15 services (minutes)
a = to_h(read("6_access_to_services", ["hhid", "s5fq0", "s5fq3a", "s5fq3b"]))
a["minutes"] = a.s5fq3a.fillna(0) * 60 + a.s5fq3b.fillna(0)
a.loc[a.s5fq3a.isna() & a.s5fq3b.isna(), "minutes"] = np.nan   # service not used: unknown, left empty
acc = a.pivot_table(index="hhid", columns="s5fq0", values="minutes", aggfunc="max")
acc.columns = [f"minutes_to_service_{int(c):02d}" for c in acc.columns]
acc["minutes_mean"] = acc.mean(axis=1)
acc = acc.reset_index()
register([c for c in acc.columns if c != "hhid"], "Distance to services", "number")
feat = feat.merge(acc, on="hhid", how="left")

#  7. a few combined clues
rooms = feat.s5aq3.replace(0, np.nan)
feat["people_per_room"] = feat.member / rooms
feat["children_per_member"] = feat.n_children / feat.member
feat["share_can_read"] = feat.n_can_read / feat.member
register(["people_per_room", "children_per_member", "share_can_read"], "Combined", "number")

#  8. clean up
clues = [c for c in feat.columns if c != "hhid"]
assert not (set(clues) & BANNED), f"banned column in clues: {set(clues) & BANNED}"
dropped = []
for c in clues:
    if feat[c].isna().mean() > 0.95 or feat[c].nunique(dropna=True) <= 1:
        dropped.append(c)
feat = feat.drop(columns=dropped)
clues = [c for c in clues if c not in dropped]
print(f"clues kept: {len(clues)} | dropped (>95% empty or constant): {dropped}")

#  9. join and check
model = base.merge(feat, on="hhid", how="left")
assert len(model) == 15054 and model.hhid.is_unique, "row count or duplicate households"
model["log_sol_jan"] = np.log(model.sol_jan)
poor = model.sol_jan < POVERTY_LINE
ext = model.sol_jan < EXTREME_LINE
w = model.pop_wt
print(f"check: poor {100*w[poor].sum()/w.sum():.1f}% (expect 27.4) | extreme {100*w[ext].sum()/w.sum():.1f}% (expect 5.4)")
model.to_csv(OUT / "model_table.csv", index=False)

fl = pd.DataFrame([(c, *groups.get(c, ("Combined", "number")), round(100 * model[c].isna().mean(), 1)) for c in clues],
                  columns=["column", "group", "type", "percent_missing"])
fl.to_csv(OUT / "feature_list.csv", index=False)

#  10. optimizer table (not clues!)
opt = base.merge(pov[["hhid", "province", "district", "ur", "member"]], on="hhid")
opt["is_poor"] = poor.astype(int).values
opt["is_extremely_poor"] = ext.astype(int).values
opt["true_gap_per_ae"] = (POVERTY_LINE - opt.sol_jan).clip(lower=0)
opt["true_gap_household"] = opt.true_gap_per_ae * opt.ae
for name, file, col, out in [
    ("Direct Support", "8_vup_direct_support", "s9d1q1", "gets_direct_support"),
    ("Classic Public Works", "9_vup_classic_public_works", "s9d2q1", "gets_classic_pw"),
    ("Expanded Public Works", "10_vup_expanded_public_works", "s9d3q1", "gets_expanded_pw"),
    ("NSDS", "11_vup_nsds", "s9d4q1", "gets_nsds"),
    ("Financial Services", "12_vup_financial_services", "s9d5q1", "applied_fs_loan"),
]:
    x = to_h(read(file, ["hhid", col]))
    flag = x.groupby("hhid")[col].apply(lambda v: int((v == 1).any()))   # a few households appear twice
    opt[out] = opt.hhid.map(flag).fillna(0).astype(int)
opt["gets_any_vup_support"] = opt[["gets_direct_support", "gets_classic_pw", "gets_expanded_pw", "gets_nsds"]].max(axis=1)
opt.to_csv(OUT / "optimizer_table.csv", index=False)
hw = opt.weight; f = opt.gets_any_vup_support == 1
print(f"check: households getting DS/cPW/ePW/NSDS today: {hw[f].sum():,.0f} (expect ~331,000) | "
      f"poor covered {100*hw[f & (opt.is_poor==1)].sum()/hw[opt.is_poor==1].sum():.1f}% (expect 14.7)")
print(f"\nmodel_table.csv: {model.shape[0]:,} rows x {model.shape[1]} columns | clues: {len(clues)}")
print("saved to output/: model_table.csv, optimizer_table.csv, feature_list.csv")