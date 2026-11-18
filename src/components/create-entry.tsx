"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, Braces, Check, Server } from "lucide-react";
import { apiRequest, type Entry, type RegistryKind } from "@/lib/registry/client";

const subscribe = () => () => {};

export function CreateEntry({ kind }: { kind: RegistryKind }) {
  const isApi = kind === "apis";
  const label = isApi ? "API" : "service";
  const [name, setName] = useState("");
  const [owner, setOwner] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const router = useRouter();
  const ready = useSyncExternalStore(subscribe, () => true, () => false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim() || !owner.trim() || saving) return;
    setSaving(true); setError("");
    try {
      const entry = await apiRequest<Entry>(`/api/${kind}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, owner }) });
      router.push(`/${kind}/${entry._id}`);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not create entry."); setSaving(false); }
  }

  return <main className="page-shell narrow-shell">
    <div className="breadcrumb"><Link href="/">WORKSPACE</Link><span className="breadcrumb-slash">/</span><Link href="/">REGISTRY</Link><span className="breadcrumb-slash">/</span><span className="breadcrumb-current">NEW {label.toUpperCase()}</span></div>
    <Link href="/" className="back-link"><ArrowLeft size={15} /> Back to registry</Link>
    <div className="create-heading"><div className={`large-icon ${isApi ? "icon-blue" : "icon-orange"}`}>{isApi ? <Braces size={24} /> : <Server size={24} />}</div><div><div className="eyebrow"><span className="eyebrow-dot" /> ADD TO YOUR WORKSPACE</div><h1>Register a {label}<span className="title-dot">.</span></h1><p className="lead">Start with the basics. You can add a YAML definition next.</p></div></div>
    <div className="form-layout"><section className="form-card"><div className="form-card-header"><div><div className="eyebrow muted-eyebrow">STEP 01</div><h2>{isApi ? "API" : "Service"} details</h2><p>Give your {label} a name and an owner.</p></div><span className="step-badge">1 <span>/</span> 2</span></div>
      <form onSubmit={submit}><div className="field"><label htmlFor="name">Name <span>*</span></label><input id="name" value={name} onChange={(event) => setName(event.target.value)} placeholder={isApi ? "e.g. quote-api" : "e.g. mobile-app"} maxLength={200} required disabled={!ready || saving} /><p>{isApi ? "A unique name to identify this API in your registry." : "Must match the consumer name in your service YAML."}</p></div><div className="field"><label htmlFor="owner">Owner <span>*</span></label><input id="owner" value={owner} onChange={(event) => setOwner(event.target.value)} placeholder="e.g. Platform team" maxLength={200} required disabled={!ready || saving} /><p>The team or person responsible for this {label}.</p></div>{error && <div className="alert-error" role="alert">{error}</div>}<div className="form-actions"><Link href="/" className="button button-secondary">Cancel</Link><button className="button button-primary" type="submit" disabled={!ready || saving || !name.trim() || !owner.trim()}>{saving ? "Creating..." : `Create ${label}`} <ArrowRight size={16} /></button></div></form>
    </section><aside className="aside-card"><div className="aside-icon"><Check size={18} /></div><h3>What happens next?</h3><p>Once created, you can upload {isApi ? "an OpenAPI YAML file" : "a consumer YAML file"} on the {label} detail page.</p><div className="aside-divider" /><span>GOOD TO KNOW</span><p>{isApi ? "The version is read from the YAML, or you can provide one if it is missing." : "Service definitions don’t require a version number."}</p></aside></div>
  </main>;
}
