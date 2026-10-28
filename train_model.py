
import warnings; warnings.filterwarnings("ignore")
from pathlib import Path
import numpy as np
import pandas as pd
import joblib
from sklearn.model_selection import GroupKFold
from sklearn.linear_model import LinearRegression
from sklearn.pipeline import make_pipeline
from sklearn.impute import SimpleImputer
from sklearn.preprocessing import StandardScaler
import lightgbm as lgb

OUT = Path("output")
POVERTY_LINE = 560127
m = pd.read_csv(OUT / "model_table.csv")
fl = pd.read_csv(OUT / "feature_list.csv")
clues = list(fl.column)
cats = list(fl[fl.type == "category"].column)

y = m.log_sol_jan.values
w = m.weight.values
groups = m.clust.values             

X_gbm = m[clues].copy()
for c in cats:
    X_gbm[c] = X_gbm[c].astype("category")
X_lin = pd.get_dummies(m[clues], columns=cats, dummy_na=True).astype(float)   # categories -> yes/no columns

models = {
    "A. Belongings count (simple)": lambda: (make_pipeline(LinearRegression()), m[["n_item_types"]].astype(float)),
    "B. Linear regression (all clues)": lambda: (make_pipeline(SimpleImputer(strategy="median"), StandardScaler(), LinearRegression()), X_lin),
    "C. LightGBM (all clues)": lambda: (lgb.LGBMRegressor(n_estimators=600, learning_rate=0.03, num_leaves=15,
                                         min_child_samples=30, subsample=0.8, subsample_freq=1,
                                         colsample_bytree=0.7, reg_lambda=5, verbose=-1, random_state=0), X_gbm),
}

gkf = GroupKFold(n_splits=5)
oof = {k: np.zeros(len(m)) for k in models}
for fold, (tr, te) in enumerate(gkf.split(m, y, groups), 1):
    for name, make in models.items():
        model, X = make()
        model.fit(X.iloc[tr], y[tr], **({"sample_weight": w[tr]} if name.startswith("C") else
                                        {"linearregression__sample_weight": w[tr]}))
        oof[name][te] = model.predict(X.iloc[te])
    print(f"fold {fold}/5 done")

true_poor = m.sol_jan.values < POVERTY_LINE
rows = []
for name, p in oof.items():
    pred_poor = np.exp(p) < POVERTY_LINE
    r2 = 1 - np.average((y - p) ** 2, weights=w) / np.average((y - np.average(y, weights=w)) ** 2, weights=w)
    tp = w[true_poor & pred_poor].sum()
    rows.append({
        "model": name,
        "R2 (1 = perfect)": round(r2, 3),
        "typical error (RMSE, log)": round(float(np.sqrt(np.average((y - p) ** 2, weights=w))), 3),
        "poor households found (%)": round(100 * tp / w[true_poor].sum(), 1),
        "poor households missed (%)": round(100 * w[true_poor & ~pred_poor].sum() / w[true_poor].sum(), 1),
        "chosen but not poor (%)": round(100 * w[~true_poor & pred_poor].sum() / w[pred_poor].sum(), 1),
        "rank correlation": round(float(pd.Series(p).corr(pd.Series(y), method="spearman")), 3),
    })
# Fairer test for targeting: pick the poorest-looking households until we have as many as there truly are poor.
share_poor = w[true_poor].sum() / w.sum()
for r, (name, p) in zip(rows, oof.items()):
    order = np.argsort(p)                              # poorest predicted first
    cum = np.cumsum(w[order]) / w.sum()
    chosen = np.zeros(len(m), bool); chosen[order[cum <= share_poor]] = True
    r["same-size pick: poor found (%)"] = round(100 * w[true_poor & chosen].sum() / w[true_poor].sum(), 1)
    r["same-size pick: not poor (%)"] = round(100 * w[~true_poor & chosen].sum() / w[chosen].sum(), 1)
res = pd.DataFrame(rows)
print("\n" + res.to_string(index=False))
res.to_csv(OUT / "model_results.csv", index=False)

pred = m[["hhid", "clust", "weight", "pop_wt", "ae", "sol_jan"]].copy()
for name, p in oof.items():
    pred["pred_" + name[0]] = np.exp(p)
pred.to_csv(OUT / "predictions.csv", index=False)

final = models["C. LightGBM (all clues)"]()[0]
final.fit(X_gbm, y, sample_weight=w)
joblib.dump({"model": final, "clues": clues, "categorical": cats}, OUT / "lightgbm_model.joblib")
imp = pd.Series(final.booster_.feature_importance("gain"), index=clues).sort_values(ascending=False)
print("\nTop 10 clues the model uses most:")
print((100 * imp / imp.sum()).round(1).head(10).to_string())
print("\nSaved: predictions.csv, model_results.csv, lightgbm_model.joblib")