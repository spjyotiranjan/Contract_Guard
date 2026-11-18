"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDownUp, ArrowRight, Box, Braces, CircleHelp, Layers3, Plus, Search, Server, X } from "lucide-react";
import { apiRequest, formatDate, type Entry, type RegistryKind } from "@/lib/registry/client";

type Filter = "all" | RegistryKind;
type Row = Entry & { kind: RegistryKind };

export function RegistryList() {
  const [rows, setRows] = useState<Row[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(() => {
    return Promise.all([apiRequest<Entry[]>("/api/apis"), apiRequest<Entry[]>("/api/services")]).then(([apis, services]) => {
      setRows([...apis.map((item) => ({ ...item, kind: "apis" as const })), ...services.map((item) => ({ ...item, kind: "services" as const }))].sort((a, b) => a.name.localeCompare(b.name)));
    }).catch((err: unknown) => { setError(err instanceof Error ? err.message : "Could not load the registry."); })
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { void load(); }, [load]);
  function retry() { setLoading(true); setError(""); void load(); }
  const visible = useMemo(() => rows.filter((item) => (filter === "all" || item.kind === filter) && `${item.name} ${item.owner}`.toLowerCase().includes(query.trim().toLowerCase())), [rows, filter, query]);
  const apiCount = rows.filter((row) => row.kind === "apis").length;
  const serviceCount = rows.length - apiCount;

  return (
    <main className="page-shell">
      <div className="breadcrumb"><span>WORKSPACE</span><span className="breadcrumb-slash">/</span><span className="breadcrumb-current">REGISTRY</span></div>
      <div className="page-heading registry-heading">
        <div><div className="eyebrow"><span className="eyebrow-dot" /> THE BIG PICTURE</div><h1>Your registry<span className="title-dot">.</span></h1><p className="lead">A single place for the APIs and services your teams rely on.</p></div>
        <div className="heading-actions"><Link href="/services/new" className="button button-secondary"><Plus size={16} /> New service</Link><Link href="/apis/new" className="button button-primary"><Plus size={16} /> New API</Link></div>
      </div>

      <section className="overview-grid" aria-label="Registry overview">
        <div className="overview-card"><div className="overview-icon icon-purple"><Layers3 size={19} /></div><div><div className="overview-label">TOTAL ENTITIES</div><div className="overview-number">{loading || error ? "—" : rows.length.toString().padStart(2, "0")}</div></div><span className="overview-note">In your registry</span></div>
        <div className="overview-card"><div className="overview-icon icon-blue"><Braces size={19} /></div><div><div className="overview-label">APIS</div><div className="overview-number">{loading || error ? "—" : apiCount.toString().padStart(2, "0")}</div></div><span className="overview-note">Registered contracts</span></div>
        <div className="overview-card"><div className="overview-icon icon-orange"><Server size={19} /></div><div><div className="overview-label">SERVICES</div><div className="overview-number">{loading || error ? "—" : serviceCount.toString().padStart(2, "0")}</div></div><span className="overview-note">Registered consumers</span></div>
      </section>

      <section className="registry-section">
        <div className="section-heading"><div><div className="eyebrow muted-eyebrow">YOUR WORKSPACE</div><h2>Explore registry <span className="count-badge">{loading || error ? "—" : rows.length}</span></h2><p>Browse and manage everything in your workspace.</p></div><div className="section-decoration"><span /><span /><span /><span /><span /></div></div>
        <div className="table-card">
          <div className="table-toolbar"><div className="tabs" aria-label="Filter registry">
            {([["all", "All entities", rows.length], ["apis", "APIs", apiCount], ["services", "Services", serviceCount]] as const).map(([value, label, count]) => <button key={value} className={`tab ${filter === value ? "active" : ""}`} onClick={() => setFilter(value)} aria-pressed={filter === value}>{label} <span>{loading || error ? "—" : count}</span></button>)}
          </div><div className="search-wrap"><Search size={16} /><input aria-label="Search by name or owner" placeholder="Search name or owner..." value={query} onChange={(event) => setQuery(event.target.value)} />{query && <button className="clear-search" onClick={() => setQuery("")} aria-label="Clear search"><X size={14} /></button>}</div></div>
          {error ? <div className="state-message" role="alert"><CircleHelp size={24} /><strong>Couldn’t load the registry</strong><p>{error}</p><button className="button button-secondary" onClick={retry}>Try again</button></div> : loading ? <div className="state-message" role="status"><span className="spinner" /><strong>Loading your registry...</strong></div> : visible.length === 0 ? <div className="state-message"><Box size={25} /><strong>{rows.length ? "No matching entities" : "Your registry is empty"}</strong><p>{rows.length ? "Try a different search or filter." : "Create an API or service to get started."}</p>{!rows.length && <Link className="text-link" href="/apis/new">Register your first API <ArrowRight size={14} /></Link>}</div> : <div className="table-scroll"><table><thead><tr><th>NAME <ArrowDownUp size={12} /></th><th>TYPE</th><th>OWNER</th><th>CREATED</th><th><span className="sr-only">View details</span></th></tr></thead><tbody>{visible.map((row) => <tr key={`${row.kind}-${row._id}`}><td><Link className="entity-link" href={`/${row.kind}/${row._id}`}><span className={`entity-icon ${row.kind === "apis" ? "icon-blue" : "icon-orange"}`}>{row.kind === "apis" ? <Braces size={17} /> : <Server size={17} />}</span><span><strong>{row.name}</strong><small>{row.kind === "apis" ? "API contract" : "Service consumer"}</small></span></Link></td><td><span className={`type-pill ${row.kind === "apis" ? "api-pill" : "service-pill"}`}><span />{row.kind === "apis" ? "API" : "Service"}</span></td><td><span className="owner-cell"><span className="owner-avatar">{row.owner.charAt(0).toUpperCase()}</span>{row.owner}</span></td><td className="date-cell">{formatDate(row.createdAt)}</td><td><Link className="row-arrow" href={`/${row.kind}/${row._id}`} aria-label={`View ${row.name}`}><ArrowRight size={17} /></Link></td></tr>)}</tbody></table></div>}
          <div className="table-footer"><span>{loading || error ? "Registry overview" : `Showing ${visible.length} of ${rows.length} ${rows.length === 1 ? "entity" : "entities"}`}</span><span className="footer-hint">SELECT AN ENTITY TO EXPLORE <ArrowRight size={13} /></span></div>
        </div>
      </section>
      <div className="bottom-note"><span><span className="status-dot" /> YOUR REGISTRY, IN ONE PLACE</span><span>CONTRACT GUARD <span className="note-separator">/</span> BUILT FOR CLARITY</span></div>
    </main>
  );
}
