import { RegistryError } from "./errors";
import type { Kind } from "./repository";

const MAX_REQUEST_SIZE = 1100 * 1024;

export function validateId(id: string): string {
  if (!/^[a-f\d]{24}$/i.test(id)) throw new RegistryError(400, "Invalid registry ID.");
  return id;
}

async function boundedRequest(request: Request): Promise<Request> {
  const length = request.headers.get("content-length");
  if (length && Number(length) > MAX_REQUEST_SIZE) throw new RegistryError(413, "Request is too large.");
  if (!request.body) throw new RegistryError(400, "Request body is required.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_REQUEST_SIZE) {
        await reader.cancel();
        throw new RegistryError(413, "Request is too large.");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
  return new Request(request.url, { method: request.method, headers: request.headers, body });
}

export async function validateCreateInput(request: Request): Promise<{ name: string; owner: string }> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) throw new RegistryError(415, "Content-Type must be application/json.");
  const bounded = await boundedRequest(request);
  let body: unknown;
  try { body = await bounded.json(); } catch { throw new RegistryError(400, "Invalid JSON body."); }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new RegistryError(400, "JSON body must be an object.");
  const { name, owner } = body as Record<string, unknown>;
  if (typeof name !== "string" || !name.trim() || name.trim().length > 200 || typeof owner !== "string" || !owner.trim() || owner.trim().length > 200) {
    throw new RegistryError(400, "name and owner are required strings of at most 200 characters.");
  }
  return { name: name.trim(), owner: owner.trim() };
}

export async function validateUploadInput(request: Request, kind: Kind): Promise<{ file: File; version?: string }> {
  if (!/^multipart\/form-data\s*;/i.test(request.headers.get("content-type") ?? "")) throw new RegistryError(415, "Content-Type must be multipart/form-data.");
  const bounded = await boundedRequest(request);
  let form: FormData;
  try { form = await bounded.formData(); } catch { throw new RegistryError(400, "Invalid multipart form data."); }
  const files = form.getAll("file");
  if (files.length !== 1 || !(files[0] instanceof File)) throw new RegistryError(400, "Exactly one YAML file is required in the file field.");
  const file = files[0];
  if (!/\.ya?ml$/i.test(file.name)) throw new RegistryError(400, "File must have a .yaml or .yml extension.");
  if (file.size === 0 || file.size > 1024 * 1024) throw new RegistryError(400, "YAML file must be between 1 byte and 1 MiB.");
  const versions = form.getAll("version");
  if (kind === "services") {
    if (versions.length) throw new RegistryError(400, "Services do not have versions.");
    return { file };
  }
  if (versions.length > 1 || (versions.length === 1 && (typeof versions[0] !== "string" || !versions[0].trim() || versions[0].trim().length > 200))) {
    throw new RegistryError(400, "API version must be a non-empty string of at most 200 characters.");
  }
  return { file, version: typeof versions[0] === "string" ? versions[0].trim() : undefined };
}
