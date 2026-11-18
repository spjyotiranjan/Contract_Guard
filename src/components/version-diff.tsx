"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, GitCompareArrows, GitCommitHorizontal } from "lucide-react";
import { apiRequest, formatDate, type Definition } from "@/lib/registry/client";
import type { DiffCategory, VersionComparison } from "@/lib/diff/types";

const labels: Record<DiffCategory, string> = {
  parameters: "Parameters",
  request: "Request bodies",
  responses: "Responses",
  schemas: "Schemas",
  components: "Other components",
  paths: "Paths & operations",
  other: "Other fields",
};

function pointer(path: string[]) {
  return "/" + path.map((part) => part.replaceAll("~", "~0").replaceAll("/", "~1")).join("/");
}

export function VersionDiff({ apiId, versions }: { apiId: string; versions: Definition[] }) {
  const ordered = useMemo(() => [...versions].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a._id.localeCompare(b._id)), [versions]);
  const [selected, setSelected] = useState<{ from: string; to: string } | null>(null);
  const [result, setResult] = useState<VersionComparison | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<DiffCategory | "all">("all");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!selected) return;
    const abort = new AbortController();
    apiRequest<VersionComparison>(`/api/apis/${apiId}/diff?from=${encodeURIComponent(selected.from)}&to=${encodeURIComponent(selected.to)}`, { signal: abort.signal })
      .then((data) => { if (!abort.signal.aborted) setResult(data); })
      .catch((err: unknown) => { if (!abort.signal.aborted) setError(err instanceof Error ? err.message : "Could not compare versions."); })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [apiId, selected, attempt]);

  function select(from: string, to: string) {
    setSelected({ from, to }); setLoading(true); setError(""); setResult(null); setFilter("all");
  }

  const visible = result?.changes.filter((change) => filter === "all" || change.category === filter) ?? [];
  return <section className="detail-card diff-section" aria-labelledby="diff-title">
    <div className="card-title"><div><div className="eyebrow muted-eyebrow">EXPLORE CHANGES</div><h2 id="diff-title">Version differences</h2><p>Compare adjacent uploads by selecting the connection between them.</p></div><span className="diff-heading-icon"><GitCompareArrows size={19} /></span></div>
    {ordered.length < 2 ? <div className="diff-empty"><GitCommitHorizontal size={23} /><strong>At least two versions needed</strong><p>Upload another API version to compare revisions.</p></div> : <div className="diff-layout">
      <div className="diff-graph" aria-label="Version connections">
        <div className="diff-graph-header">UPLOAD TIMELINE <span>OLDEST FIRST</span></div>
        <p className="diff-graph-hint">Connections represent upload order, not version ancestry.</p>
        <ol className="timeline">{ordered.map((version, index) => <li key={version._id}>
          <div className="timeline-node"><span className="timeline-dot" /><div><strong>{version.version}</strong><span>{version.sourceFile || "Uploaded YAML"}</span><small>{formatDate(version.createdAt)} · {version._id.slice(-6)}</small></div></div>
          {index < ordered.length - 1 && <div className="timeline-link"><span className="timeline-line" /><button aria-label={`Compare ${version.version} (${version._id.slice(-6)}) to ${ordered[index + 1].version} (${ordered[index + 1]._id.slice(-6)})`} aria-pressed={selected?.from === version._id && selected?.to === ordered[index + 1]._id} className={`edge-button ${selected?.from === version._id && selected?.to === ordered[index + 1]._id ? "selected" : ""}`} onClick={() => select(version._id, ordered[index + 1]._id)}>View changes <ArrowRight size={13} /></button></div>}
        </li>)}</ol>
      </div>
      <div className="diff-panel" aria-live="polite">
        {!selected ? <div className="diff-panel-empty"><GitCompareArrows size={22} /><strong>Select a connection</strong><p>Choose an edge to see what changed between its two revisions.</p></div> : loading ? <div className="diff-panel-empty" role="status"><span className="spinner" /><strong>Comparing versions...</strong></div> : error ? <div className="diff-panel-empty" role="alert"><strong>Couldn’t compare versions</strong><p>{error}</p><button className="button button-secondary" onClick={() => { setError(""); setLoading(true); setAttempt((n) => n + 1); }}>Try again</button></div> : result && <>
          <div className="diff-panel-heading"><div><span className="eyebrow muted-eyebrow">COMPARISON</span><h3>{result.from.version} <ArrowRight size={15} /> {result.to.version}</h3><p>{result.from.id.slice(-6)} → {result.to.id.slice(-6)} · {result.changes.length}{result.truncated ? "+" : ""} changes</p></div></div>
          <p className="diff-disclaimer">Structural changes only; this does not determine compatibility. References are not resolved.</p>
          {result.truncated && <div className="alert-error" role="status">Showing the first 5,000 changes; the comparison was truncated.</div>}
          <div className="diff-filter"><label htmlFor="diff-filter">Show</label><select id="diff-filter" value={filter} onChange={(event) => setFilter(event.target.value as DiffCategory | "all")}><option value="all">All changes</option>{(Object.keys(labels) as DiffCategory[]).map((key) => <option key={key} value={key}>{labels[key]} ({result.changes.filter((change) => change.category === key).length})</option>)}</select></div>
          {visible.length === 0 ? <div className="diff-no-changes">{result.changes.length ? "No changes in this category." : "No structural differences found."}</div> : <div className="changes-list">{visible.map((change, index) => <details className="change-card" key={`${pointer(change.path)}-${index}`}><summary><span className={`change-action ${change.action}`}>{change.action}</span><span className="change-location"><strong>{labels[change.category]}</strong><code>{pointer(change.path)}</code></span></summary><div className="change-values">{change.action !== "added" && <div><span>BEFORE</span><pre>{JSON.stringify(change.before, null, 2)}</pre></div>}{change.action !== "removed" && <div><span>AFTER</span><pre>{JSON.stringify(change.after, null, 2)}</pre></div>}</div></details>)}</div>}
        </>}
      </div>
    </div>}
  </section>;
}
