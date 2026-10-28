
import json, warnings; warnings.filterwarnings("ignore")
from pathlib import Path
import numpy as np
import pandas as pd
import joblib, shap
import matplotlib; matplotlib.use("Agg")
import matplotlib.pyplot as plt

OUT = Path("output")
POVERTY_LINE, EXTREME_LINE = 560127, 356432
m = pd.read_csv(OUT / "model_table.csv")
fl = pd.read_csv(OUT / "feature_list.csv")
bundle = joblib.load(OUT / "lightgbm_model.joblib")
model, clues, cats = bundle["model"], bundle["clues"], bundle["categorical"]
VALUE_LABELS = {c: {int(k): v for k, v in d.items()} for c, d in json.load(open("value_labels.json")).items()}

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
    "s5aq1": "Type of settlement", "s5aq2": "Type of dwelling", "s5aq3": "Number of sleeping rooms", "s5aq7": "Who owns the dwelling",
    "s5cq1": "Main water source", "s5cq3": "Main drinking water source", "s5cq14": "Electricity connection",
    "s5cq16": "Main lighting source", "s5cq21": "Type of cook stove", "s5cq22a": "Main cooking fuel",
    "s5cq25": "Type of toilet", "s5cq26": "Toilet shared with another household",
    "s5dq1": "Wall material", "s5dq2": "Roof material", "s5dq3": "Floor material", "s5dq4": "Floor area",
    "s5eq1": "Bad event in last 12 months", "s5eq2a": "Worst bad event", "s5eq4a": "Months to recover from bad event",
    "s7aq4a": "Cattle owned", "s7aq4b": "Goats owned", "s7aq4c": "Sheep owned", "s7aq4d": "Pigs owned",
    "s7aq4e": "Poultry owned", "s7aq4f": "Other animals owned",
    "head_age": "Age of household head", "head_female": "Head is a woman (1=yes)", "head_marital": "Marital status of head",
    "head_school": "School level of head", "head_can_read": "Head can read (1=yes)", "n_children": "Number of children (under 15)",
    "n_elderly": "Number of elderly (65+)", "share_female": "Share of members who are women",
    "max_school": "Highest school level in the household", "n_can_read": "Members who can read",
    "n_can_write": "Members who can write", "n_can_calc": "Members who can calculate",
    "n_insured": "Members with health insurance", "n_disabled": "Members with a serious disability",
    "n_phone": "Members with a mobile phone", "any_smartphone": "Someone has a smartphone (1=yes)",
    "any_computer": "Someone has a computer (1=yes)", "any_internet": "Someone uses the internet (1=yes)",
    "n_item_types": "Number of different belongings owned", "n_items_total": "Total belongings owned",
    "has_account": "Has a bank/mobile money account (1=yes)", "has_bank_or_momo": "Has a bank or mobile money account (1=yes)",
    "in_tontine": "Member of a tontine (1=yes)", "tried_loan": "Tried to get a loan (1=yes)", "owes_money": "Owes money (1=yes)",
    "minutes_mean": "Average minutes to services", "people_per_room": "People per sleeping room",
    "children_per_member": "Share of members who are children", "share_can_read": "Share of members who can read",
}
for k, v in ITEMS.items():
    PLAIN[f"owns_item_{k:02d}"] = f"Owns: {v} (1=yes)"
for k, v in SERVICES.items():
    PLAIN[f"minutes_to_service_{k:02d}"] = f"Minutes to {v}"
def plain(c): return PLAIN.get(c, c)

def show_value(c, v):
    if pd.isna(v): return "not known"
    if c in VALUE_LABELS and int(v) in VALUE_LABELS[c]: return VALUE_LABELS[c][int(v)]
    if c == "s5eq2a" and int(v) == 0: return "no bad event"
    return f"{v:.2f}".rstrip("0").rstrip(".")

# ------------------------------------------------------------------ SHAP values
X = m[clues].copy()
for c in cats: X[c] = X[c].astype("category")
explainer = shap.TreeExplainer(model)
sv = explainer.shap_values(X)                        # one number per household per clue, in log-spending units
base = float(np.ravel(explainer.expected_value)[0])
print(f"typical (average) household spending = {np.exp(base):,.0f} Rwf per adult per year")
assert np.allclose(sv.sum(axis=1) + base, model.predict(X), atol=1e-4), "SHAP parts must add up to the prediction"

pd.concat([m[["hhid"]], pd.DataFrame(sv, columns=clues)], axis=1).to_csv(OUT / "shap_values.csv", index=False)

# ------------------------------------------------------------------ chart 1: top clues
imp = pd.Series(np.abs(sv).mean(axis=0), index=clues).sort_values(ascending=False)
top = imp.head(15)[::-1]
plt.figure(figsize=(9, 6)); plt.barh([plain(c) for c in top.index], top.values, color="#1F4E79")
plt.xlabel("Average push on the prediction (bigger = matters more)"); plt.title("The 15 clues the model relies on most")
plt.tight_layout(); plt.savefig(OUT / "shap_top_clues.png", dpi=150); plt.close()

# ------------------------------------------------------------------ chart 2: by group
grp = fl.set_index("column").group
by_group = imp.groupby(grp.reindex(imp.index)).sum().sort_values()
plt.figure(figsize=(8, 5)); plt.barh(by_group.index, by_group.values, color="#1F4E79")
plt.xlabel("Total push on the prediction"); plt.title("Which kinds of clues matter most")
plt.tight_layout(); plt.savefig(OUT / "shap_by_group.png", dpi=150); plt.close()
print("\nTop 10 clues:"); [print(f"  {plain(c):45s} {v:.3f}") for c, v in imp.head(10).items()]
print("\nBy group:"); [print(f"  {g:25s} {v:.3f}") for g, v in by_group[::-1].items()]

# ------------------------------------------------------------------ three example households
rng = np.random.RandomState(1)
pred = np.exp(sv.sum(axis=1) + base)
picks = {
    "Extremely poor household": rng.choice(np.where(m.sol_jan < EXTREME_LINE)[0]),
    "Moderately poor household": rng.choice(np.where((m.sol_jan >= EXTREME_LINE) & (m.sol_jan < POVERTY_LINE))[0]),
    "Not poor household": rng.choice(np.where(m.sol_jan >= POVERTY_LINE * 2)[0]),
}
lines = []
for title, i in picks.items():
    lines += ["=" * 70, f"{title}  (hhid {m.hhid[i]})",
              f"  Real spending per adult per year : {m.sol_jan[i]:>10,.0f} Rwf",
              f"  Model's guess                    : {pred[i]:>10,.0f} Rwf   (typical household: {np.exp(base):,.0f})", ""]
    order = np.argsort(sv[i])
    lines.append("  Clues pushing the guess DOWN (poorer):")
    for j in order[:5]:
        c = clues[j]; lines.append(f"    {plain(c):42s} = {show_value(c, m[c][i]):32s} {100*(np.exp(sv[i, j])-1):+6.0f}%")
    lines.append("  Clues pushing the guess UP (richer):")
    for j in order[::-1][:5]:
        c = clues[j]; lines.append(f"    {plain(c):42s} = {show_value(c, m[c][i]):32s} {100*(np.exp(sv[i, j])-1):+6.0f}%")
    lines.append("")
text = "\n".join(lines)
(OUT / "example_explanations.txt").write_text(text, encoding="utf-8")
print("\n" + text)
print("Saved: shap_top_clues.png, shap_by_group.png, shap_values.csv, example_explanations.txt")