// The API returns district_code and district name but no province or map position,
// so the frontend keeps this small lookup. Codes follow the contract examples
// (25 Nyamagabe, 33 Rubavu, 55 Kirehe, 22 Gisagara). x and y place each district on
// the tile map; replace the tile map with a GeoJSON map later and match on district_code.
export const DISTRICT_LAYOUT = {
  11: { name: "Nyarugenge", province: "Kigali City", x: 3, y: 2 },
  12: { name: "Gasabo", province: "Kigali City", x: 4, y: 1 },
  13: { name: "Kicukiro", province: "Kigali City", x: 4, y: 2 },
  21: { name: "Nyanza", province: "Southern", x: 3, y: 4 },
  22: { name: "Gisagara", province: "Southern", x: 2, y: 5 },
  23: { name: "Nyaruguru", province: "Southern", x: 1, y: 4 },
  24: { name: "Huye", province: "Southern", x: 2, y: 4 },
  25: { name: "Nyamagabe", province: "Southern", x: 1, y: 3 },
  26: { name: "Ruhango", province: "Southern", x: 2, y: 3 },
  27: { name: "Muhanga", province: "Southern", x: 2, y: 2 },
  28: { name: "Kamonyi", province: "Southern", x: 3, y: 3 },
  31: { name: "Karongi", province: "Western", x: 0, y: 2 },
  32: { name: "Rutsiro", province: "Western", x: 0, y: 1 },
  33: { name: "Rubavu", province: "Western", x: 0, y: 0 },
  34: { name: "Nyabihu", province: "Western", x: 1, y: 1 },
  35: { name: "Ngororero", province: "Western", x: 1, y: 2 },
  36: { name: "Rusizi", province: "Western", x: 0, y: 4 },
  37: { name: "Nyamasheke", province: "Western", x: 0, y: 3 },
  41: { name: "Rulindo", province: "Northern", x: 3, y: 1 },
  42: { name: "Gakenke", province: "Northern", x: 2, y: 1 },
  43: { name: "Musanze", province: "Northern", x: 2, y: 0 },
  44: { name: "Burera", province: "Northern", x: 3, y: 0 },
  45: { name: "Gicumbi", province: "Northern", x: 4, y: 0 },
  51: { name: "Rwamagana", province: "Eastern", x: 5, y: 2 },
  52: { name: "Nyagatare", province: "Eastern", x: 5, y: 0 },
  53: { name: "Gatsibo", province: "Eastern", x: 5, y: 1 },
  54: { name: "Kayonza", province: "Eastern", x: 6, y: 2 },
  55: { name: "Kirehe", province: "Eastern", x: 6, y: 3 },
  56: { name: "Ngoma", province: "Eastern", x: 5, y: 3 },
  57: { name: "Bugesera", province: "Eastern", x: 4, y: 3 },
};

// Plain-language note shown when a strategy bar is selected. Keyed by the
// strategy id in GET /overview.
export const STRATEGY_NOTES = {
  S0: "Every household gets the same small amount. Money is spread thin, so few households are lifted.",
  S5: "How today's VUP support is shared, with the same budget.",
  S1: "Rank households by the model's guess and help the poorest until the money runs out.",
  S2: "Also chooses the best program for each household. Highest result, but some districts get little.",
  S3: "Same as Optimized, but every district keeps at least half of its fair share. Costs 0.1 points.",
  S4: "If we knew every household's real spending. A ceiling no model can reach.",
};
