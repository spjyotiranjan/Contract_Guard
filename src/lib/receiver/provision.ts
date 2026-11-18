import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import { stringify } from "yaml";
import type { ApiVersion } from "../registry/types";

export type ProvisionResult =
  | { status: "provisioned"; endpointCount: number; basePath: string }
  | { status: "failed" | "not_configured"; message: string };

export async function provisionVersion(record: ApiVersion): Promise<ProvisionResult> {
  const url = process.env.CONTRACT_RECEIVER_WS_URL;
  const token = process.env.CONTRACT_RECEIVER_TOKEN;
  if (!url && !token) return { status: "not_configured", message: "Contract receiver is not configured." };
  if (!url || !token || token.length < 16) return { status: "failed", message: "Receiver URL and a token of at least 16 characters are required." };
  try {
    const parsed = new URL(url);
    if (!["ws:", "wss:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.pathname !== "/ws" || parsed.search || parsed.hash) throw new Error("Invalid receiver URL.");
    if (parsed.protocol === "ws:" && !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)) throw new Error("Unencrypted receiver connections are restricted to localhost; use wss for remote connections.");
    const requestId = randomUUID();
    const message = JSON.stringify({ type: "provision", requestId, apiId: record.apiId.toHexString(), versionId: record._id.toHexString(), yaml: stringify(record.definition) });
    if (Buffer.byteLength(message) > 2 * 1024 * 1024) throw new Error("Serialized contract exceeds the receiver message limit.");
    return await new Promise<ProvisionResult>((resolve) => {
      let done = false;
      const socket = new WebSocket(url, { headers: { Authorization: `Bearer ${token}` }, handshakeTimeout: 5000, maxPayload: 2 * 1024 * 1024 });
      const finish = (result: ProvisionResult) => { if (done) return; done = true; clearTimeout(timer); socket.terminate(); resolve(result); };
      const timer = setTimeout(() => finish({ status: "failed", message: "Receiver provisioning timed out." }), 8000);
      socket.on("open", () => socket.send(message));
      socket.on("error", () => finish({ status: "failed", message: "Unable to connect to the contract receiver." }));
      socket.on("close", () => finish({ status: "failed", message: "Receiver connection closed before acknowledging provisioning." }));
      socket.on("message", (raw) => {
        try {
          const response = JSON.parse(raw.toString());
          if (response.requestId !== requestId) return;
          if (response.ok !== true) return finish({ status: "failed", message: typeof response.error === "string" ? response.error.slice(0, 500) : "Receiver rejected the contract." });
          if (response.data?.apiId !== record.apiId.toHexString() || response.data?.versionId !== record._id.toHexString() || !Array.isArray(response.data?.endpoints) || typeof response.data?.basePath !== "string") throw new Error();
          finish({ status: "provisioned", endpointCount: response.data.endpoints.length, basePath: response.data.basePath });
        } catch { finish({ status: "failed", message: "Receiver returned an invalid response." }); }
      });
    });
  } catch (error) { return { status: "failed", message: error instanceof Error ? error.message : "Receiver provisioning failed." }; }
}
