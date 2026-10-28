import { ApiError } from "./errors.js";
import { saveBlob } from "./download.js";

const env = import.meta.env || {};
export const BASE_URL = (env.VITE_API_URL || "http://localhost:8000").replace(/\/$/, "");

async function toApiError(res) {
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* not JSON */
  }
  const e = body && body.error;
  return new ApiError(e?.code || "SERVER_ERROR", e?.message || `The backend returned an error (${res.status}).`, e?.details || [], res.status);
}

async function request(path, init) {
  let res;
  try {
    res = await fetch(BASE_URL + path, init);
  } catch {
    throw new ApiError("NETWORK", `Could not reach the backend at ${BASE_URL}. Check that it is running.`);
  }
  if (!res.ok) throw await toApiError(res);
  return res;
}

const getJson = async (path, init) => (await request(path, init)).json();

async function download(path, fallbackName) {
  const res = await request(path);
  const blob = await res.blob();
  const cd = res.headers.get("content-disposition") || "";
  const name = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd)?.[1] || fallbackName;
  saveBlob(blob, decodeURIComponent(name));
}

// One method per endpoint in API_CONTRACT.md. The demo backend in
// src/mock/mockApi.js exposes exactly the same methods.
export const realApi = {
  kind: "live",

  // 3.1
  health: () => getJson("/health"),
  // 3.2
  schema: () => getJson("/schema"),
  // 3.3
  downloadSample: (withSpending = false) =>
    download(`/sample-file${withSpending ? "?with_spending=true" : ""}`, "households_sample.csv"),
  // 3.4
  validate(file) {
    const body = new FormData();
    body.append("file", file);
    return getJson("/validate", { method: "POST", body });
  },
  // 3.5
  scan({ file, budget, programs, fair }) {
    const body = new FormData();
    body.append("file", file);
    body.append("budget", String(budget));
    body.append("programs", JSON.stringify(programs));
    body.append("fair", fair ? "true" : "false");
    return getJson("/scan", { method: "POST", body });
  },
  // 3.6
  downloadScanCsv: (scanId) => download(`/scan/${encodeURIComponent(scanId)}/csv`, `scan_${scanId}.csv`),
  // 3.7
  overview: () => getJson("/overview"),
  // 3.8
  household: (hhid, scanId) =>
    getJson(`/household/${encodeURIComponent(hhid)}${scanId ? `?scan_id=${encodeURIComponent(scanId)}` : ""}`),
  // 3.9
  fairness: () => getJson("/fairness"),
};
