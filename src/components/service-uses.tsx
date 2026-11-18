"use client";

import { Braces } from "lucide-react";
import { DefinitionTree } from "./definition-tree";

type Use = { provider: string; method: string; path: string; sends: string[]; reads: string[]; [key: string]: unknown };

function validUse(value: unknown): value is Use {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return typeof item.provider === "string" && typeof item.method === "string" && typeof item.path === "string" && Array.isArray(item.sends) && item.sends.every((field) => typeof field === "string") && Array.isArray(item.reads) && item.reads.every((field) => typeof field === "string");
}

function FieldList({ label, fields }: { label: string; fields: string[] }) {
  return <div className="use-fields"><h5>{label}</h5>{fields.length ? <ul>{fields.map((field, index) => <li key={`${field}-${index}`}><code>{field}</code></li>)}</ul> : <p>None specified</p>}</div>;
}

export function ServiceUses({ definition }: { definition: Record<string, unknown> }) {
  const uses = definition.uses;
  if (!Array.isArray(uses) || !uses.every(validUse)) return <p className="service-uses-note">This definition’s uses could not be displayed here. View the complete definition below.</p>;
  if (!uses.length) return <p className="service-uses-note">No API uses specified in this definition.</p>;
  const groups = new Map<string, Use[]>();
  for (const use of uses) groups.set(use.provider, [...(groups.get(use.provider) ?? []), use]);

  return <div className="service-uses">
    <p className="service-uses-note">Providers and endpoints declared in this YAML. API versions are not specified.</p>
    {[...groups].map(([provider, endpoints]) => <details className="provider-group" key={provider} open>
      <summary><span className="provider-icon"><Braces size={16} /></span><strong>{provider}</strong><span className="provider-count">{endpoints.length} {endpoints.length === 1 ? "endpoint" : "endpoints"}</span></summary>
      <div className="provider-endpoints">{endpoints.map((use, index) => {
        const extra = Object.fromEntries(Object.entries(use).filter(([key]) => !["provider", "method", "path", "sends", "reads"].includes(key)));
        return <details className="endpoint-use" key={`${use.method}-${use.path}-${index}`}>
          <summary><span className="method-pill">{use.method}</span><code>{use.path}</code></summary>
          <div className="endpoint-details"><div className="endpoint-fields"><FieldList label="SENDS" fields={use.sends} /><FieldList label="READS" fields={use.reads} /></div>{Object.keys(extra).length > 0 && <div className="endpoint-extra"><h5>ADDITIONAL DETAILS</h5><DefinitionTree definition={extra} /></div>}</div>
        </details>;
      })}</div>
    </details>)}
  </div>;
}
