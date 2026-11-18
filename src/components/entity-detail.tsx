"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, Braces, CalendarDays, ChevronDown, ChevronRight, FileCode2, FileUp, Fingerprint, Layers3, Plus, Server, Upload, UserRound, X } from "lucide-react";
import { apiRequest, formatDate, type Definition, type Entry, type RegistryKind } from "@/lib/registry/client";
import { parseDocument } from "yaml";
import { DefinitionTree } from "./definition-tree";
import { VersionDiff } from "./version-diff";

export function EntityDetail({ kind, id }: { kind: RegistryKind; id: string }) {
  const isApi = kind === "apis";
  const collection = isApi ? "versions" : "definitions";
  const title = isApi ? "API" : "Service";
  const [entry, setEntry] = useState<Entry | null>(null);
  const [definitions, setDefinitions] = useState<Definition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [version, setVersion] = useState("");
  const [versionState, setVersionState] = useState<"idle" | "reading" | "detected" | "missing" | "invalid">("idle");
  const fileSelection = useRef(0);
  const [file, setFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState("");
  const [success, setSuccess] = useState("");
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const uploadButtonRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    return Promise.all([apiRequest<Entry>(`/api/${kind}/${id}`), apiRequest<Definition[]>(`/api/${kind}/${id}/${collection}`)]).then(([entity, records]) => {
      setEntry(entity); setDefinitions(records);
    }).catch((err: unknown) => { setError(err instanceof Error ? err.message : "Could not load details."); })
      .finally(() => setLoading(false));
  }, [collection, id, kind]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!showUpload) return;
    closeRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !uploading) {
        fileSelection.current++; setShowUpload(false); setFile(null); setVersion(""); setVersionState("idle"); setUploadError("");
        uploadButtonRef.current?.focus();
      }
      if (event.key === "Tab" && modalRef.current) {
        const focusable = Array.from(modalRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex="-1"])'));
        if (!focusable.length) { event.preventDefault(); return; }
        const first = focusable[0]; const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [showUpload, uploading]);
  function retry() { setLoading(true); setError(""); void load(); }
  function closeUpload() { fileSelection.current++; setShowUpload(false); setFile(null); setVersion(""); setVersionState("idle"); setUploadError(""); uploadButtonRef.current?.focus(); }

  async function selectFile(selected: File | null) {
    const selection = ++fileSelection.current;
    setFile(selected); setVersion(""); setUploadError("");
    if (!isApi || !selected) { setVersionState("idle"); return; }
    if (selected.size === 0 || selected.size > 1024 * 1024 || !/\.ya?ml$/i.test(selected.name)) {
      setVersionState("invalid"); setUploadError("Choose a .yaml or .yml file between 1 byte and 1 MiB."); return;
    }
    setVersionState("reading");
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(await selected.arrayBuffer());
      const doc = parseDocument(text, { uniqueKeys: true, strict: true });
      if (doc.errors.length || doc.warnings.length) throw new Error();
      const data: unknown = doc.toJS({ maxAliasCount: 100 });
      if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error();
      const info = (data as Record<string, unknown>).info;
      if (!info || typeof info !== "object" || Array.isArray(info)) throw new Error();
      const declared = (info as Record<string, unknown>).version;
      if (selection !== fileSelection.current) return;
      if (declared === undefined) { setVersionState("missing"); return; }
      if (typeof declared !== "string" || !declared.trim() || declared !== declared.trim() || declared.length > 200) {
        setVersionState("invalid"); setUploadError("YAML info.version must be a non-empty string of at most 200 characters without surrounding whitespace."); return;
      }
      setVersion(declared); setVersionState("detected");
    } catch {
      if (selection !== fileSelection.current) return;
      setVersionState("invalid"); setUploadError("Unable to read this YAML. Check that it is valid UTF-8 and includes an info object.");
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || (isApi && (!version.trim() || !["detected", "missing"].includes(versionState))) || uploading) return;
    setUploading(true); setUploadError(""); setSuccess("");
    try {
      const form = new FormData(); form.append("file", file);
      if (isApi) form.append("version", version.trim());
      const saved = await apiRequest<Definition>(`/api/${kind}/${id}/${collection}`, { method: "POST", body: form });
      setDefinitions((records) => [saved, ...records]); setExpanded(saved._id); setShowUpload(false); setVersion(""); setVersionState("idle"); setFile(null);
      uploadButtonRef.current?.focus();
      if (inputRef.current) inputRef.current.value = "";
      setSuccess(isApi ? "API version uploaded successfully." : "Service definition uploaded successfully.");
    } catch (err) { setUploadError(err instanceof Error ? err.message : "Could not upload the file."); }
    finally { setUploading(false); }
  }

  return <main className="page-shell">
    <div className="breadcrumb"><Link href="/">WORKSPACE</Link><span className="breadcrumb-slash">/</span><Link href="/">REGISTRY</Link><span className="breadcrumb-slash">/</span><span className="breadcrumb-current">{title.toUpperCase()} DETAILS</span></div>
    <Link href="/" className="back-link"><ArrowLeft size={15} /> Back to registry</Link>
    {loading ? <div className="state-message detail-state" role="status"><span className="spinner" /><strong>Loading details...</strong></div> : error || !entry ? <div className="state-message detail-state" role="alert"><strong>Couldn’t load this {title.toLowerCase()}</strong><p>{error || "Entry not found."}</p><button className="button button-secondary" onClick={retry}>Try again</button></div> : <>
      <div className="detail-heading"><div className={`large-icon ${isApi ? "icon-blue" : "icon-orange"}`}>{isApi ? <Braces size={24} /> : <Server size={24} />}</div><div className="detail-title"><div className="eyebrow"><span className="eyebrow-dot" /> {title.toUpperCase()} DETAILS</div><h1>{entry.name}<span className="title-dot">.</span></h1><p className="lead">{isApi ? "Manage your API contract and its versions." : "Manage this service and its consumer definitions."}</p></div><button ref={uploadButtonRef} className="button button-primary" onClick={() => { setShowUpload(true); setSuccess(""); }}><Plus size={16} /> {isApi ? "Add version" : "Upload YAML"}</button></div>
      {isApi && <VersionDiff apiId={id} versions={definitions} />}
      <div className="detail-layout"><div className="detail-main">
        <section className="detail-card"><div className="card-title"><div><div className="eyebrow muted-eyebrow">THE ESSENTIALS</div><h2>Overview</h2></div><span className={`type-pill ${isApi ? "api-pill" : "service-pill"}`}><span />{title}</span></div><div className="metadata-grid"><div><span><UserRound size={15} /> OWNER</span><strong>{entry.owner}</strong></div><div><span><CalendarDays size={15} /> CREATED</span><strong>{formatDate(entry.createdAt)}</strong></div><div><span><CalendarDays size={15} /> UPDATED</span><strong>{formatDate(entry.updatedAt)}</strong></div><div><span><Fingerprint size={15} /> REGISTRY ID</span><strong className="mono-text">{entry._id}</strong></div></div></section>
        <section className="detail-card definitions-card"><div className="card-title"><div><div className="eyebrow muted-eyebrow">YOUR CONTRACTS</div><h2>{isApi ? "Versions" : "Definitions"} <span className="count-badge">{definitions.length}</span></h2><p>{isApi ? "OpenAPI documents registered to this API." : "YAML definitions registered to this service."}</p></div></div>
          {success && <div className="alert-success" role="status">{success}</div>}
          {definitions.length === 0 ? <div className="definition-empty"><span><FileCode2 size={23} /></span><strong>Nothing here yet</strong><p>{isApi ? "Add a version to start tracking this API’s contract." : "Upload a YAML file to define this service."}</p><button className="text-link" onClick={() => setShowUpload(true)}><Plus size={15} /> {isApi ? "Add your first version" : "Upload a definition"}</button></div> : <div className="definition-list">{definitions.map((record) => <div className="definition-item" key={record._id}><button className="definition-trigger" aria-expanded={expanded === record._id} onClick={() => setExpanded(expanded === record._id ? null : record._id)}><span className="file-icon"><FileCode2 size={18} /></span><span className="definition-name"><strong>{isApi ? `Version ${record.version}` : (record.sourceFile || "Service definition")}</strong><small>{record.sourceFile && isApi ? `${record.sourceFile} · ` : ""}Added {formatDate(record.createdAt)}</small></span><span className="definition-chevron">{expanded === record._id ? <ChevronDown size={18} /> : <ChevronRight size={18} />}</span></button>{expanded === record._id && <div className="definition-body"><div className="definition-info"><div><span>RECORD ID</span><code>{record._id}</code></div><div><span>SOURCE FILE</span><code>{record.sourceFile || "—"}</code></div><div><span>SHA-256</span><code>{record.sourceHash}</code></div>{!isApi && <div><span>API BINDINGS</span><code>{record.bindings?.length ?? 0}</code></div>}</div><div className="json-heading"><span>PARSED DEFINITION</span><span>EXPAND FIELDS TO EXPLORE</span></div><DefinitionTree definition={record.definition} /></div>}</div>)}</div>}
        </section>
      </div><aside className="aside-card detail-aside"><div className="aside-icon"><Layers3 size={18} /></div><h3>About this {title.toLowerCase()}</h3><p>{isApi ? "Each version keeps its complete parsed OpenAPI definition, ready to explore." : "Each upload keeps the complete consumer definition. API versions are not inferred from service YAML."}</p><div className="aside-divider" /><span>UPLOAD GUIDELINES</span><p>Use a UTF-8 .yaml or .yml file, up to 1 MiB. {isApi ? "The version is read from info.version, or you can provide one if it is missing." : "The consumer name must match this service’s name."}</p></aside></div>
      {showUpload && <div className="modal-backdrop" onClick={(event) => { if (event.target === event.currentTarget && !uploading) closeUpload(); }}><div ref={modalRef} className="modal" role="dialog" aria-modal="true" aria-labelledby="upload-title"><div className="modal-heading"><div><div className="eyebrow muted-eyebrow">ADD TO {entry.name.toUpperCase()}</div><h2 id="upload-title">{isApi ? "Add a version" : "Upload a definition"}</h2><p>{isApi ? "Upload an OpenAPI YAML file for this version." : "Upload the YAML file that describes this service."}</p></div><button ref={closeRef} className="icon-button" aria-label="Close" disabled={uploading} onClick={closeUpload}><X size={19} /></button></div><form onSubmit={submit}><div className="field"><label htmlFor="yaml-file">YAML file <span>*</span></label><label className="file-picker" htmlFor="yaml-file"><FileUp size={22} /><strong>{file ? file.name : "Choose a YAML file"}</strong><span>{file ? `${(file.size / 1024).toFixed(1)} KB · Click to change` : ".yaml or .yml, up to 1 MiB"}</span></label><input ref={inputRef} className="visually-hidden-file" id="yaml-file" type="file" accept=".yaml,.yml" required onChange={(event) => void selectFile(event.target.files?.[0] ?? null)} />{!isApi && <p>The consumer field must match <strong>{entry.name}</strong>.</p>}</div>{isApi && versionState === "reading" && <p className="version-hint" role="status">Checking the YAML for a version?</p>}{isApi && versionState === "detected" && <div className="version-detected" role="status">Version detected from YAML: <strong>{version}</strong></div>}{isApi && versionState === "missing" && <div className="field"><label htmlFor="version">Version <span>*</span></label><input id="version" placeholder="e.g. 1.0.0" value={version} onChange={(event) => setVersion(event.target.value)} maxLength={200} required /><p>No info.version was found. Enter a version to add it to the saved definition.</p></div>}{uploadError && <div className="alert-error" role="alert">{uploadError}</div>}<div className="form-actions"><button className="button button-secondary" type="button" disabled={uploading} onClick={closeUpload}>Cancel</button><button className="button button-primary" disabled={uploading || !file || (isApi && (!version.trim() || !["detected", "missing"].includes(versionState)))} type="submit"><Upload size={15} /> {uploading ? "Uploading..." : "Upload YAML"}</button></div></form></div></div>}
    </>}
  </main>;
}
