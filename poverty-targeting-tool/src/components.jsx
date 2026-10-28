import React from "react";

export const fmt = (n) => (n == null || Number.isNaN(Number(n)) ? "—" : Math.round(Number(n)).toLocaleString("en-US"));
export const fmtM = (n) => (Number(n) / 1e6).toFixed(1);
export const pct1 = (n) => `${Number(n).toFixed(1)}%`;

export function Stat({ label, value, hint, tone }) {
  return (
    <div className="card stat">
      <div className="label">{label}</div>
      <div className={`value ${tone || ""}`}>{value}</div>
      <div className="hint">{hint}</div>
    </div>
  );
}

export function Bar({ pct, tone = "", dim = false }) {
  return (
    <div className="track" role="presentation">
      <div className={`fill ${tone} ${dim ? "dim" : ""}`} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </div>
  );
}

export function Badge({ level, children }) {
  return <span className={`badge ${level}`}>{children}</span>;
}

export function Loading({ what = "data" }) {
  return (
    <div className="loading" role="status">
      <div className="spinner" />
      Loading {what}…
    </div>
  );
}

// Shows an ApiError (or any error) with its details and optional actions.
export function ErrorBox({ error, onRetry, children }) {
  return (
    <div className="errbox" role="alert">
      <b>{error?.code && error.code !== "NETWORK" && error.code !== "SERVER_ERROR" ? `${error.code}: ` : ""}{error?.message || "Something went wrong."}</b>
      {error?.details?.length > 0 && (
        <ul>
          {error.details.slice(0, 8).map((d, i) => <li key={i}>{String(d)}</li>)}
          {error.details.length > 8 && <li>and {error.details.length - 8} more</li>}
        </ul>
      )}
      <div className="errbox-actions">
        {onRetry && <button className="btn small" onClick={onRetry}>Try again</button>}
        {children}
      </div>
    </div>
  );
}
