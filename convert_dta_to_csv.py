
from pathlib import Path
import pandas as pd

RAW_DIR = Path("raw_data")   
OUT_DIR = Path("data_csv")   


FILES = {
    "CS_EICV7_poverty_file": "1_poverty_file",            # TARGET (sol_jan), weights, location
    "CS_S01_S5_S7_Household": "2_household_file",         # house, water, energy, livestock, shocks
    "CS_S0_S1_S2_S3_S4_S6A_S6B_S6C_Person": "3_person_file",  # age, sex, education, health, phone
    "CS_S10B_durables": "4_durables_file",                # belongings (27 items)
    "CS_S10C_Savings": "5_savings_file",                  # bank / mobile money / tontine
    "CS_S5F_access_to_services": "6_access_to_services",  # distance to 15 services
    "CS_S10A1_A2_credits": "7_loans_file",                # loans (optional feature group)
    "CS_S9D1_Direct_Support": "8_vup_direct_support",     # VUP receipt + cost (Stage 2)
    "CS_S9D2_Classic_Public_Work": "9_vup_classic_public_works",
    "CS_S9D3_Expanded_Public_Work": "10_vup_expanded_public_works",
    "CS_S9D4_NSDS": "11_vup_nsds",
    "CS_S9D5_Financial_Services": "12_vup_financial_services",
}


def find(stem: str) -> Path:
    hits = list(RAW_DIR.rglob(stem + ".dta"))
    if not hits:
        raise FileNotFoundError(f"Could not find {stem}.dta under {RAW_DIR.resolve()}")
    return hits[0]


def main() -> None:
    OUT_DIR.mkdir(exist_ok=True)
    for stem, out_name in FILES.items():
        src = find(stem)
        # convert_categoricals=False keeps the numeric codes (1/2/3), 
        df = pd.read_stata(src, convert_categoricals=False)
        dst = OUT_DIR / f"{out_name}.csv"
        df.to_csv(dst, index=False)
        print(f"{src.name:55s} -> {dst.name:35s} {len(df):>9,} rows x {df.shape[1]} cols")


if __name__ == "__main__":
    main()