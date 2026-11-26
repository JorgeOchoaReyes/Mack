// A model chosen from the list a provider offers (the same list as Setup),
// or typed when it is not listed ("Other…") or the list cannot be read (no key
// for that provider yet). Used by the Benchmark's model rows and Settings.

import { useEffect, useState } from "react";
import { api, errorText, type ProviderId } from "../api";

/** The models each provider offers, listed once per provider (with its key), or why they could not be listed. */
export function useModelLists(providers: ProviderId[]): Record<string, string[] | { error: string } | undefined> {
  const [lists, setLists] = useState<Record<string, string[] | { error: string } | undefined>>({});
  const wanted = [...new Set(providers)].join(",");
  useEffect(() => {
    for (const p of new Set(providers)) {
      if (lists[p]) continue;
      void api.listModels(p).then(
        (ms: string[]) => setLists((l) => ({ ...l, [p]: [...ms].sort((a, b) => a.localeCompare(b)) })),
        (e: unknown) => setLists((l) => ({ ...l, [p]: { error: errorText(e) } })),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted]);
  return lists;
}

const OTHER = "__other__";

/**
 * A model chosen from the provider's list, or typed when it is not there
 * ("Other…") or the list cannot be read (no key yet). `none` is the label of
 * an empty choice, for optional fields.
 */
export function ModelSelect({ value, onChange, list, placeholder, none, label }: { value: string; onChange: (v: string) => void; list: string[] | { error: string } | undefined; placeholder: string; none?: string; label: string }) {
  const listed = Array.isArray(list) ? list : null;
  const [typing, setTyping] = useState(false);
  const known = !value || !!listed?.includes(value);
  if (!listed || typing || !known) {
    return (
      <span className="model-select">
        <input className="input" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} title={list && !Array.isArray(list) ? `Could not list the models: ${list.error}` : undefined} />
        {listed && (
          <button
            className="link small"
            onClick={() => {
              setTyping(false);
              if (!known) onChange("");
            }}
          >
            choose from the list
          </button>
        )}
      </span>
    );
  }
  return (
    <select className="input" value={value} aria-label={label} onChange={(e) => (e.target.value === OTHER ? setTyping(true) : onChange(e.target.value))}>
      <option value="">{none ?? "Choose a model…"}</option>
      {listed.map((m) => (
        <option key={m} value={m}>
          {m}
        </option>
      ))}
      <option value={OTHER}>Other (type a model id)…</option>
    </select>
  );
}
