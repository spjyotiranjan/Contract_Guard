"use client";

import { Fragment, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

type Node = { key: string; value: unknown; path: string; depth: number };

function children(node: Node): Node[] {
  if (node.value === null || typeof node.value !== "object") return [];
  return Object.entries(node.value).map(([key, value]) => ({
    key: Array.isArray(node.value) ? `[${key}]` : key,
    value,
    path: `${node.path}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`,
    depth: node.depth + 1,
  }));
}

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

export function DefinitionTree({ definition }: { definition: Record<string, unknown> }) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  function toggle(path: string) {
    setExpanded((old) => {
      const next = new Set(old);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  }
  function renderNode(node: Node): React.ReactNode {
    const type = typeOf(node.value);
    const isContainer = type === "array" || type === "object";
    const entries = isContainer ? children(node) : [];
    const open = expanded.has(node.path);
    return <Fragment key={node.path}>
      <tr>
        <th scope="row"><div className="tree-key" style={{ paddingLeft: `${node.depth * 20}px` }}>
          {entries.length ? <button className="tree-toggle" aria-label={`${open ? "Collapse" : "Expand"} ${node.key}`} aria-expanded={open} onClick={() => toggle(node.path)}>{open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</button> : <span className="tree-spacer" />}
          <span>{node.key}</span>
        </div></th>
        <td><span className={`tree-type tree-type-${type}`}>{type}</span></td>
        <td className="tree-value">{isContainer ? `${entries.length} ${type === "array" ? (entries.length === 1 ? "item" : "items") : (entries.length === 1 ? "field" : "fields")}` : type === "string" ? String(node.value) : JSON.stringify(node.value)}</td>
      </tr>
      {open && entries.map(renderNode)}
    </Fragment>;
  }
  const root = { key: "root", value: definition, path: "", depth: -1 };
  return <div className="tree-table-scroll"><table className="tree-table"><thead><tr><th scope="col">FIELD</th><th scope="col">TYPE</th><th scope="col">VALUE</th></tr></thead><tbody>{children(root).map(renderNode)}</tbody></table>{Object.keys(definition).length === 0 && <p className="tree-empty">This definition is empty.</p>}</div>;
}
