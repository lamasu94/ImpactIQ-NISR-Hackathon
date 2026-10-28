# Poverty Targeting Tool (React + Vite)

Frontend for the four screens: Overview, Upload and scan, Scan results, Explain and fairness.
It talks to the Python backend described in `API_CONTRACT.md` (v0.1).

## Run

```
npm install
npm run dev          # http://localhost:5173
```

Start the backend first (`uvicorn api:app --reload`, port 8000). The backend allows
`http://localhost:5173` and `http://localhost:3000` through CORS.

## Backend or demo data

On start the app calls `GET /health`.

- **Reachable:** live mode, every screen uses the real endpoints.
- **Not reachable:** the app switches to **demo mode** and shows an amber banner with a "Retry connection" button. Demo mode uses a built-in stand-in model that returns the same response shapes as the contract, so every screen still works. Its numbers are illustrative only.

Settings (copy `.env.example` to `.env`):

| Variable | Default | Meaning |
|---|---|---|
| `VITE_API_URL` | `http://localhost:8000` | Backend address |
| `VITE_USE_MOCK` | unset | `true` forces demo mode |

## Which screen calls what

| Screen | Calls |
|---|---|
| Overview | `GET /overview` |
| Upload and scan | `GET /schema`, `POST /validate` (on file pick), `POST /scan`, `GET /sample-file[?with_spending=true]` |
| Scan results | uses the `POST /scan` response; `GET /scan/{id}/csv` for the download |
| Explain and fairness | `GET /household/{hhid}[?scan_id=]`, `GET /fairness` |

All calls live in `src/api/client.js`, one method per endpoint. `src/mock/mockApi.js` has the same methods.
Errors use the contract shape `{error:{code,message,details}}` and arrive as an `ApiError`.
If a scan returns `NOT_FOUND` (backend restarted), the app goes back to Upload with a message.

## Things the frontend keeps itself

`src/lib/layout.js` holds the province and tile-map position of each district by `district_code`
(the API does not return these), and the plain-language note for each strategy id (S0 to S5).
Replace the tile map with a GeoJSON map later by matching on `district_code`.
