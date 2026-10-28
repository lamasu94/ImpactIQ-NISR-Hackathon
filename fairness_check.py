
import json
from pathlib import Path
import numpy as np
import pandas as pd

OUT = Path("output")
L = 560127
pred = pd.read_csv(OUT / "predictions.csv")[["hhid", "pred_C"]]
m = pd.read_csv(OUT / "model_table.csv", usecols=["hhid", "head_female", "n_disabled", "n_children", "member"])
t = pd.read_csv(OUT / "optimizer_table.csv").merge(pred, on="hhid").merge(m[["hhid", "head_female", "n_disabled"]], on="hhid")
got = pd.read_csv(OUT / "allocation_fair.csv")[["hhid", "money_given"]]
t = t.merge(got, on="hhid", how="left"); t["money_given"] = t.money_given.fillna(0)
t["helped"] = t.money_given > 0
t["poor"] = t.is_poor == 1
t["guess_poor"] = t.pred_C < L
t["province_name"] = t.province.map({1: "Kigali City", 2: "Southern", 3: "Western", 4: "Northern", 5: "Eastern"})
t["area"] = t.ur.map({1: "Urban", 2: "Rural"})
t["head"] = t.head_female.map({0: "Man", 1: "Woman"})
t["disability"] = np.where(t.n_disabled > 0, "Has a member with serious disability", "No serious disability")

def table(col):
    rows = []
    for g, d in t.groupby(col):
        rows.append({
            "group": g, "households": len(d),
            "share who are poor (%)": round(100 * d.poor.mean(), 1),
            "model: poor households it also sees as poor (%)": round(100 * (d.poor & d.guess_poor).sum() / max(d.poor.sum(), 1), 1),
            "model: typical guess vs real (1.00 = right)": round(float(np.exp(np.log(d.pred_C / d.sol_jan).median())), 2),
            "poor households that get help (%)": round(100 * (d.poor & d.helped).sum() / max(d.poor.sum(), 1), 1),
            "of those helped, not poor (%)": round(100 * (d.helped & ~d.poor).sum() / max(d.helped.sum(), 1), 1),
        })
    return pd.DataFrame(rows)

pd.set_option("display.width", 250); pd.set_option("display.max_columns", 20)
parts = []
for col, name in [("area", "City or countryside"), ("province_name", "Province"), ("head", "Sex of household head"), ("disability", "Disability in the household")]:
    x = table(col); x.insert(0, "type", name); parts.append(x)
by_group = pd.concat(parts); by_group.to_csv(OUT / "fairness_by_group.csv", index=False)
print(by_group.to_string(index=False))

NAMES = {int(k): v for k, v in json.load(open("value_labels.json"))["district"].items()}
t["district_name"] = t.district.map(NAMES)
dist = table("district_name").sort_values("poor households that get help (%)")
dist.to_csv(OUT / "fairness_by_district.csv", index=False)
print("\nDistricts with the LOWEST share of poor households helped:"); print(dist.head(5).to_string(index=False))
print("\nDistricts with the HIGHEST share:"); print(dist.tail(3).to_string(index=False))