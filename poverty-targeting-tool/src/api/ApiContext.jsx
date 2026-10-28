import { createContext, useContext, useEffect, useState } from "react";

const Ctx = createContext(null);
export const ApiProvider = Ctx.Provider;
export const useApiClient = () => useContext(Ctx);

// Runs an API call and tracks loading / error / data. Re-runs when deps change.
export function useAsync(fn, deps) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    Promise.resolve()
      .then(fn)
      .then(
        (data) => alive && setState({ loading: false, data, error: null }),
        (error) => alive && setState({ loading: false, data: null, error })
      );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { ...state, reload: () => setTick((t) => t + 1) };
}
