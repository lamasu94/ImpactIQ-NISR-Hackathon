# Poverty Targeting Tool

**Machine Learning Optimization of Social Resource Allocation for Poverty Reduction in Rwanda**

Rwanda has a limited budget to help poor households, and the current way of choosing who gets help makes mistakes. This project does two things:

1. **Estimates which households are poor** from simple facts about them (housing, belongings, family, services nearby), using a machine learning model.
2. **Decides who should get which program** from a fixed budget, so that as much poverty as possible is closed, and no district is left behind.

Every decision comes with a plain-English reason, and a fairness report shows where the system works less well.

> This is a hackathon prototype. It estimates poverty **today**. It does not forecast the future, and it does not replace human judgement.

---

## Results at a glance

All strategies get the **same budget** (209.8 million Rwf, the cost of today's VUP support in the survey sample) and are scored with the households' **true** spending.

| Strategy | Poverty gap closed |
|---|---|
| Even spread across districts | 3.1% |
| Today's VUP pattern | 4.2% |
| Poorest first (by model prediction) | 10.2% |
| Optimized | 10.5% |
| **Optimized and fair (our recommendation)** | **10.4%** |
| Perfect knowledge (best possible, a benchmark) | 14.6% |

- With the same money, the system closes about **2.5 times** more of the poverty gap than today's pattern.
- The fairness rule costs only 0.1 percentage points.
- The model predicts spending with R² = 0.69 on villages it has never seen. A simple "count belongings" score reaches 0.29, and linear regression 0.41.

See [Limitations](#limitations) before quoting these numbers.

---

## How it works

```
EICV7 survey files (.dta)
        |  convert_dta_to_csv.py, check_data.py
        v
   CSV files  ---- prepare_data.py ---->  model_table.csv (one row per household, 100 clues)
                                                |
                           train_model.py       v
                      LightGBM model  <---  5-fold test by village
                           |  explain_model.py (SHAP)      |
                           v                               v
                   reasons for each guess          predicted spending per household
                                                           |  optimize_allocation.py
                                                           v
                                          who gets which program, within the budget
                                                           |  fairness_check.py
                                                           v
                                                   fairness report
        pipeline.py  +  api.py (FastAPI)  --->  React dashboard (frontend/)
```

### Stage 1: predict
- **Target:** `sol_jan`, yearly consumption per adult equivalent in January 2024 prices. Below **560,127 Rwf** a household is poor, and below **356,432 Rwf** it is extremely poor.
- **Clues:** 100 columns built from the survey: location, household makeup, education, health, phone and internet, dwelling, water, energy and toilet, animals, bad events, 27 belongings, savings and loans, and travel time to 15 services.
- **Never used as clues:** anything built from spending (expenditure files, `quintile`, `cons1`, and so on) or the poverty codes. `prepare_data.py` stops with an error if one slips in.
- **Models compared:** a belongings count, linear regression, and **LightGBM** (our main model).
- **Testing:** 5-fold cross-validation grouped by village cluster, so the model is always tested on villages it never saw.
- **Explanations:** SHAP shows which clues pushed each household's guess up or down.

### Stage 2: share the money
- Model predictions are noisy, so for each household we compute the **expected poverty gap closed** by each program, assuming the real spending is spread around the guess (log error of 0.34).
- A solver (PuLP with CBC) picks at most one program per household to maximize the benefit, with extremely poor households counting double, subject to:
  - the **budget**,
  - **one program** per household,
  - an optional **fair-share rule**: each district gets at least 50% of the money its share of poor households would earn.
- Programs and yearly cost per household (from the VUP thematic report): Direct Support 128,572 Rwf, Classic Public Works 87,994 Rwf, Expanded Public Works 149,422 Rwf.

---

## The dashboard

| Screen | What it does |
|---|---|
| **Overview** | National picture: poverty rate, poorest provinces and districts, and the comparison of strategies. |
| **Upload and scan** | Upload a household file, set the budget, programs and fairness rule, and press **Run AI scan**. Shows file checks first. |
| **Scan results** | Who is chosen, money by program and district, a searchable table, and a CSV download. |
| **Explain and fairness** | Why a household got its score, plus the fairness table by area, province, sex of head and disability. |

---

## Repository layout

```
dev/
  README.md
  API_CONTRACT.md          the agreement between backend and frontend
  requirements.txt
  api.py                   FastAPI server (9 endpoints)
  pipeline.py              the logic behind the API
  value_labels.json        meaning of the survey's category codes
  convert_dta_to_csv.py    step 1  .dta to CSV
  check_data.py            step 2  checks the data against NISR's published numbers
  prepare_data.py          step 3  builds the model table
  train_model.py           step 4  trains and compares the models
  explain_model.py         step 5  SHAP explanations
  optimize_allocation.py   step 6  compares the allocation strategies
  fairness_check.py        step 7  fairness by group and district
  raw_data/                the NISR .dta files
  data_csv/                converted CSV files
  output/                  tables, model and charts made by the scripts
  frontend/                the React app
```

---

## Setup

You need **Python 3.10 to 3.12** and **Node.js** (for the frontend).

```bash
python -m venv .venv
# Windows PowerShell:  .venv\Scripts\Activate.ps1
# Mac / Linux:         source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt
```

> **Keep `pulp==2.9.0`.** PuLP 4 changed its interface and has no built-in solver, so the optimizer fails with it.

### Run the application
```bash
# Terminal 1: backend (from the folder that contains api.py)
uvicorn api:app --reload
# wait for "Application startup complete", then check http://localhost:8000/health
# interactive API docs: http://localhost:8000/docs

# Terminal 2: frontend
cd frontend
npm install
npm run dev        # or: npm start
```
Open the address the frontend prints (usually `http://localhost:5173` or `http://localhost:3000`). The backend allows those two ports. If yours differs, add it to the CORS list in `api.py`.

### Rebuild everything from the raw data
Put the NISR `.dta` files in `raw_data/`, then run in order:

```bash
python convert_dta_to_csv.py     # about 1 minute
python check_data.py             # must end with ALL CHECKS PASSED
python prepare_data.py           # builds output/model_table.csv
python train_model.py            # about 5 minutes
python explain_model.py
python optimize_allocation.py    # about 2 minutes
python fairness_check.py
```
You only need this if you change the data or the model. The saved results in `output/` are enough to run the application.

---

## The data

- **Source:** National Institute of Statistics of Rwanda (NISR), **EICV7 2023-24 cross-sectional survey** (catalog 119). It covers 15,054 households and 62,110 people in all 30 districts and 1,674 village clusters.
- **Files used (12):** poverty file, household, person, durables, savings, access to services, loans, and the five VUP files.
- **Checks:** our poverty rates match NISR's published figures (27.4% of people poor, 5.4% extremely poor), and our poverty classes match NISR's for every household.

### Upload format
A CSV with one row per household, containing `hhid`, `ae` (adult equivalents), and the 100 clue columns. `GET /schema` lists them with plain-English labels, and `GET /sample-file` downloads a ready-made example. The file may also include `sol_jan` (real spending) to get measured results. It must **not** contain spending or poverty columns. The maximum is 5,000 rows.

> **Budget tip:** the default budget (209.8 million) is for all 15,054 households. For a smaller file, use about **13,937 Rwf per household** (for example, about 13.9 million for 1,000 households).

---

## API

Nine endpoints, fully described in [`API_CONTRACT.md`](API_CONTRACT.md):

| Endpoint | Purpose |
|---|---|
| `GET /health` | Is the server up |
| `GET /schema` | Columns, programs and default budget for the upload form |
| `GET /sample-file` | Example household CSV |
| `POST /validate` | Check a file before scanning |
| `POST /scan` | Predict and allocate |
| `GET /scan/{id}/csv` | Download the chosen households |
| `GET /overview` | National figures for the Overview screen |
| `GET /household/{hhid}` | The reasons behind one household's score |
| `GET /fairness` | Fairness tables |

---

## Fairness findings

The "optimized and fair" plan is fairer than today's pattern, but not fair everywhere:

- It finds poor households **less well where poverty is rare** (for example Kirehe, and Northern province, where only 13.6% of poor households get help and 45% of those helped are not poor).
- Households **headed by women** are found slightly less often than those headed by men (27% against 33% of poor households helped).
- Households with a member who has a serious disability are served well (39% of poor households helped).

The "Review" labels in the dashboard come from simple rules, not from a judgement of whether the difference is unfair.

---

## Limitations

- **Predicting poverty is not predicting benefit.** We assume that poorer households gain most from help. A real program trial would be needed to know.
- **The benefit model is simple.** A transfer is assumed to close the gap one-for-one, and the cost of each program is an average from a report.
- **One snapshot in time.** EICV7 is a cross-section, with about 486 households per district, so district results are noisy.
- **Results are on the survey sample**, not scaled to national totals.
- **The model is not tuned**, and uses one fixed error size for every household.
- **The sample file comes from the survey the model was trained on.** Measured results on it look better than they would on new data. The dashboard warns about this.
- **The Imibereho registry is not used.** We could not find a public description of how it sorts households, so the tool offers an alternative and does not copy it.

---

## Team

ImpactIQ · Members: Lama Suleiman, Abayo Emery · Supervisor: Professor Sunday IDOWU.  NISR Big Data Hackathon

## Sources

- NISR, EICV7 2023-24 cross-sectional microdata, catalog 119: https://microdata.statistics.gov.rw/index.php/catalog/119
- NISR, EICV7 VUP Thematic Report (program amounts)
- NISR, EICV7 press release: https://statistics.gov.rw/press/news/eicv7-survey-revealed-significant-decline-poverty-and-great-improvement-socio-economic
