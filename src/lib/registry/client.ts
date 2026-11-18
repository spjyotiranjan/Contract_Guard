export type RegistryKind = "apis" | "services";

export interface Entry {
  _id: string;
  name: string;
  owner: string;
  createdAt: string;
  updatedAt: string;
}

export interface Definition {
  _id: string;
  version?: string;
  sourceFile?: string;
  sourceHash: string;
  createdAt: string;
  definition: Record<string, unknown>;
  bindings?: unknown[];
  apiId?: string;
  serviceId?: string;
}

export async function apiRequest<T>(path: string, options?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { ...options, cache: "no-store" });
  } catch {
    throw new Error("Could not connect to the registry. Please try again.");
  }
  let result: { data?: T; error?: string };
  try { result = await response.json(); }
  catch { throw new Error("The registry returned an unexpected response."); }
  if (!response.ok) throw new Error(result.error || "Something went wrong. Please try again.");
  return result.data as T;
}

export function formatDate(date: string) {
  const value = new Date(date);
  return Number.isNaN(value.getTime()) ? "—" : new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(value);
}
