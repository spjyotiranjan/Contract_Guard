"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Background, BaseEdge, Controls, Handle, MarkerType, Position, ReactFlow, useNodesState, type Edge, type EdgeProps, type Node, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Braces, Server, X } from "lucide-react";
import { apiRequest } from "@/lib/registry/client";
import type { GraphConnection, RegistryGraph, VariationAnalysis } from "@/lib/analysis/types";

type Port = { id: string; top: number };
type ServiceNode = Node<{ name: string; owner: string; definitionId?: string; ports: Port[] }, "service">;
type ApiNode = Node<{ name: string; owner: string; versions: { id: string; version: string; sourceFile?: string }[]; ports: Record<string, Port[]> }, "api">;
type MissingNode = Node<{ name: string; ports: Port[] }, "missing">;
type RoutedEdge = Edge<{ lane: number; count: number }, "routed">;
type Selection = { connection: GraphConnection; versionId?: string };

function Handles({ ports, type, position }: { ports: Port[]; type: "source" | "target"; position: Position }) {
  return <>{ports.map((port) => <Handle key={port.id} id={port.id} type={type} position={position} style={{ top: `${port.top}%` }} />)}</>;
}
function ServiceBox({ data, id, selected }: NodeProps<ServiceNode>) {
  return <div className={`graph-service-node ${selected ? "graph-node-selected" : ""}`}><div className="graph-node-title"><span className="entity-icon icon-orange"><Server size={16} /></span><div><strong>{data.name}</strong><small>{data.owner}</small></div></div><p>{data.definitionId ? `Definition ${data.definitionId.slice(-6)}` : "No definition uploaded"}</p><Link href={`/services/${id}`} className="graph-node-link nodrag">View service →</Link><Handles ports={data.ports} type="source" position={Position.Right} /></div>;
}
function ApiBox({ data, id }: NodeProps<ApiNode>) {
  return <div className="graph-api-node"><div className="graph-api-header"><Handles ports={data.ports.api ?? []} type="target" position={Position.Left} /><div className="graph-node-title"><span className="entity-icon icon-blue"><Braces size={16} /></span><div><strong>{data.name}</strong><small>{data.owner}</small></div></div></div><div className="graph-version-list">{data.versions.length === 0 ? <p>No versions uploaded</p> : data.versions.map((version) => <div className="graph-version" key={version.id}><Handles ports={data.ports[version.id] ?? []} type="target" position={Position.Left} /><span>{version.version}</span><small title={version.sourceFile}>{version.sourceFile || "revision"} · {version.id.slice(-6)}</small></div>)}</div><Link href={`/apis/${id}`} className="graph-node-link nodrag">View API →</Link></div>;
}
function MissingBox({ data }: NodeProps<MissingNode>) {
  return <div className="graph-missing-node"><Handles ports={data.ports} type="target" position={Position.Left} /><strong>{data.name}</strong><small>API not registered</small></div>;
}
function RoutedConnection({ id, sourceX, sourceY, targetX, targetY, data, style, markerEnd, interactionWidth }: EdgeProps<RoutedEdge>) {
  // Separate control points give each connection its own lane. Crossings remain
  // possible when nodes are rearranged, but edges do not share a single trunk.
  const lane = data?.lane ?? 0; const count = data?.count ?? 1;
  const offset = (lane - (count - 1) / 2) * 22;
  const span = Math.max(65, Math.abs(targetX - sourceX) * 0.42);
  const path = `M ${sourceX} ${sourceY} C ${sourceX + span + offset} ${sourceY}, ${targetX - span + offset} ${targetY}, ${targetX} ${targetY}`;
  return <BaseEdge id={id} path={path} style={style} markerEnd={markerEnd} interactionWidth={interactionWidth} />;
}
const nodeTypes = { service: ServiceBox, api: ApiBox, missing: MissingBox };
const edgeTypes = { routed: RoutedConnection };

function VariationResults({ variations }: { variations: VariationAnalysis }) {
  return <div className="variation-results"><h4>CONTRACT VARIATIONS <span className={`analysis-status ${variations.status}`}>{variations.status === "match" ? "Compatible" : variations.status === "unknown" ? "Warning" : "Incompatible"}</span></h4><p>Declared JSON body contracts only; not a runtime safety guarantee.</p><ul>{variations.checks.map((check, index) => <li key={index}><strong>{check.method} {check.path} · {check.direction}{check.responseStatus ? ` ${check.responseStatus}` : ""}</strong><span>{check.status === "match" ? "Compatible" : check.status === "unknown" ? "Warning" : "Incompatible"} · {check.coverage} · {check.checked} checked</span><span>{check.message}</span>{Object.hasOwn(check, "example") && <pre>{JSON.stringify(check.example, null, 2)}</pre>}</li>)}</ul></div>;
}

function makeGraph(graph: RegistryGraph) {
  const nodes: Node[] = []; const edges: RoutedEdge[] = [];
  const lookup = new Map<string, Selection>();
  const descriptors: { id: string; source: string; target: string; targetGroup: string; versionId?: string; connection: GraphConnection; match: boolean }[] = [];
  graph.connections.forEach((connection, connectionIndex) => {
    const target = connection.apiId || `missing:${connection.provider}`;
    const matching = connection.versions.filter((version) => version.status === "match");
    if (matching.length) matching.forEach((version) => descriptors.push({ id: `edge-${connectionIndex}-${version.versionId}`, source: connection.serviceId, target, targetGroup: version.versionId, versionId: version.versionId, connection, match: true }));
    else descriptors.push({ id: `edge-${connectionIndex}`, source: connection.serviceId, target, targetGroup: "api", connection, match: false });
  });
  const sourceGroups = new Map<string, string[]>(); const targetGroups = new Map<string, string[]>();
  for (const edge of descriptors) {
    const targetKey = JSON.stringify([edge.target, edge.targetGroup]);
    sourceGroups.set(edge.source, [...(sourceGroups.get(edge.source) ?? []), edge.id]);
    targetGroups.set(targetKey, [...(targetGroups.get(targetKey) ?? []), edge.id]);
  }
  const ports = (ids: string[] = []): Port[] => ids.map((id, index) => ({ id, top: 15 + (70 * (index + 1)) / (ids.length + 1) }));
  graph.services.forEach((service, index) => nodes.push({ id: service.id, type: "service", position: { x: 0, y: index * 175 }, data: { ...service, ports: ports(sourceGroups.get(service.id)) } }));
  let apiY = 0;
  graph.apis.forEach((api) => {
    const apiPorts: Record<string, Port[]> = {};
    for (const group of ["api", ...api.versions.map((version) => version.id)]) apiPorts[group] = ports(targetGroups.get(JSON.stringify([api.id, group])));
    nodes.push({ id: api.id, type: "api", position: { x: 650, y: apiY }, data: { ...api, ports: apiPorts } });
    apiY += 150 + Math.max(1, api.versions.length) * 60;
  });
  const missing = [...new Set(graph.connections.filter((connection) => !connection.apiId).map((connection) => connection.provider))];
  missing.forEach((provider) => {
    const id = `missing:${provider}`;
    nodes.push({ id, type: "missing", position: { x: 650, y: apiY }, data: { name: provider, ports: ports(targetGroups.get(JSON.stringify([id, "api"]))) } }); apiY += 130;
  });
  descriptors.forEach((edge, index) => {
    const color = edge.match ? "#5ca477" : "#b0a4bc";
    lookup.set(edge.id, { connection: edge.connection, versionId: edge.versionId });
    edges.push({ id: edge.id, source: edge.source, sourceHandle: edge.id, target: edge.target, targetHandle: edge.id, type: "routed", data: { lane: index, count: descriptors.length }, style: { stroke: color, strokeWidth: 2, ...(edge.match ? {} : { strokeDasharray: "5 5" }) }, markerEnd: { type: MarkerType.ArrowClosed, color }, interactionWidth: 20, ariaLabel: `Inspect ${edge.connection.provider} connection`, focusable: true });
  });
  return { nodes, edges, lookup };
}

function GraphCanvas({ graph, onSelect, selectedService, onSelectService }: { graph: RegistryGraph; onSelect: (selection: Selection | null) => void; selectedService: string | null; onSelectService: (id: string | null) => void }) {
  const initial = useMemo(() => makeGraph(graph), [graph]);
  const [nodes, , onNodesChange] = useNodesState(initial.nodes);
  const edges = useMemo(() => initial.edges.map((edge) => {
    const active = selectedService === edge.source;
    return { ...edge, style: { ...edge.style, opacity: selectedService && !active ? 0.18 : 1, strokeWidth: active ? 3.5 : 2 }, zIndex: active ? 2 : 0 };
  }), [initial.edges, selectedService]);
  function selectService(id: string | null) {
    onSelectService(id);
  }
  return <div className="graph-canvas" aria-label="Registry dependency graph"><ReactFlow nodes={nodes.map((node) => ({ ...node, selected: node.type === "service" && node.id === selectedService }))} edges={edges} onNodesChange={onNodesChange} nodeTypes={nodeTypes} edgeTypes={edgeTypes} nodesDraggable nodesConnectable={false} elementsSelectable panOnDrag zoomOnScroll fitView fitViewOptions={{ padding: 0.2 }} minZoom={0.1} maxZoom={1.5}
    onNodeClick={(_, node) => { if (node.type === "service") { selectService(node.id); onSelect(null); } }}
    onPaneClick={() => { selectService(null); onSelect(null); }}
    onEdgeClick={(_, edge) => { const selection = initial.lookup.get(edge.id); if (selection) { selectService(selection.connection.serviceId); onSelect(selection); } }}>
    <Background color="#e6e1ee" gap={22} size={1.1} /><Controls showInteractive={false} />
  </ReactFlow></div>;
}

export function RegistryGraphView() {
  const [graph, setGraph] = useState<RegistryGraph | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Selection | null>(null);
  const [selectedService, setSelectedService] = useState<string | null>(null);
  const load = useCallback(() => apiRequest<RegistryGraph>("/api/registry/graph").then(setGraph).catch((err: unknown) => setError(err instanceof Error ? err.message : "Unable to load graph.")).finally(() => setLoading(false)), []);
  useEffect(() => { void load(); }, [load]);
  const activeVersion = selected?.connection.versions.find((version) => version.versionId === selected.versionId);
  return <section className="registry-section graph-section"><div className="section-heading"><div><div className="eyebrow muted-eyebrow">DEPENDENCY MAP</div><h2>Service connections</h2><p>Explore declared dependencies and structurally matching API revisions.</p></div><button className="button button-secondary" onClick={() => { setLoading(true); setError(""); setSelected(null); setSelectedService(null); void load(); }} disabled={loading}>Refresh analysis</button></div>
    <p className="graph-disclaimer">Drag nodes to rearrange, pan or zoom the canvas, and select a service to highlight its connections. Matches check declared fields and endpoints only, not runtime compatibility. Latest uploaded service definition is analyzed.</p>
    {loading ? <div className="state-message" role="status"><span className="spinner" /><strong>Analyzing registry...</strong></div> : error ? <div className="state-message" role="alert"><strong>Couldn’t load analysis</strong><p>{error}</p><button className="button button-secondary" onClick={() => { setLoading(true); setError(""); void load(); }}>Try again</button></div> : graph && !graph.services.length && !graph.apis.length ? <div className="state-message"><strong>No entities to map</strong><p>Create APIs and services to populate the graph.</p></div> : graph && <div className="graph-layout"><GraphCanvas graph={graph} onSelect={setSelected} selectedService={selectedService} onSelectService={setSelectedService} /><aside className="graph-panel">{!selected ? <div className="graph-panel-empty"><strong>{selectedService ? `${graph.services.find((service) => service.id === selectedService)?.name ?? "Service"} connections` : "Select a connection"}</strong><p>{selectedService ? "Choose a connection to inspect its API revisions." : "Select a service or connection to inspect its API revisions. Green edges represent structural matches; dashed edges have no confirmed match."}</p>{selectedService && <button className="graph-clear-filter" onClick={() => setSelectedService(null)}>Show all connections</button>}{graph.connections.filter((connection) => !selectedService || connection.serviceId === selectedService).length > 0 ? <div className="graph-accessible-list"><span>DECLARED CONNECTIONS</span>{graph.connections.filter((connection) => !selectedService || connection.serviceId === selectedService).map((connection) => <button key={`${connection.serviceId}:${connection.provider}`} onClick={() => { setSelectedService(connection.serviceId); setSelected({ connection }); }}>{graph.services.find((service) => service.id === connection.serviceId)?.name} &#8594; {connection.provider}</button>)}</div> : <p>{selectedService ? "This service has no declared connections." : "No declared connections."}</p>}</div> : <><div className="graph-panel-heading"><div><span>CONNECTION ANALYSIS</span><h3>{graph.services.find((service) => service.id === selected.connection.serviceId)?.name} → {selected.connection.provider}</h3><p>{selected.connection.useCount} declared {selected.connection.useCount === 1 ? "endpoint" : "endpoints"} · definition {selected.connection.definitionId.slice(-6)}</p></div><button aria-label="Close analysis" onClick={() => setSelected(null)}><X size={17} /></button></div>{!selected.connection.apiId ? <p className="graph-panel-message">This provider is not registered as an API.</p> : !selected.connection.versions.length ? <p className="graph-panel-message">This API has no versions to analyze.</p> : <div className="graph-results">{selected.connection.versions.map((version) => <details key={version.versionId} open={version.versionId === activeVersion?.versionId}><summary><span className={`analysis-status ${version.status}`}>{version.status === "match" ? "Structural match" : version.status === "unknown" ? "Warning" : version.status}</span><strong>{version.version}</strong><small>{version.sourceFile || "revision"} · {version.versionId.slice(-6)}</small></summary>{version.issues.length ? <ul>{version.issues.map((issue, index) => <li key={index}><strong>{issue.method} {issue.path}</strong><span>{issue.message}</span></li>)}</ul> : <p>All supported structural checks passed. Types, values, authentication and runtime behavior are not verified.</p>}<VariationResults variations={version.variations} /></details>)}</div>}</>}</aside></div>}
  </section>;
}
