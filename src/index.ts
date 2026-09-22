import { createHash, randomBytes } from "node:crypto";

const OPENCODE_UA = "opencode/1.18.23 ai-sdk/provider-utils/4.0.23 runtime/bun/1.4.0";
const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

function base62(bytes: Uint8Array, length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += BASE62[bytes[i % bytes.length] % 62];
  return out;
}

/**
 * Map a pi session id (UUID) to a valid OpenCode session id matching
 * packages/opencode/src/id/id.ts: `ses_` + 12 hex timestamp bytes + 14 base62.
 * Hashing keeps affinity stable per pi session and distinct across sessions.
 */
export function mapSessionId(piSessionId: string): string {
  const hash = createHash("sha256").update(`opencode-free:${piSessionId}`).digest();
  const hex = hash.subarray(0, 6).toString("hex");
  return `ses_${hex}${base62(hash.subarray(6), 14)}`;
}

/** Random valid OpenCode request id (`msg_` + 12 hex + 14 base62). */
function requestId(): string {
  return `msg_${randomBytes(6).toString("hex")}${base62(randomBytes(14), 14)}`;
}

function setHeader(headers: Record<string, string | null | undefined>, key: string, value: string): void {
  // Preserve case if key already present (headers may be mixed-case)
  for (const k of Object.keys(headers)) {
    if (k.toLowerCase() === key) {
      headers[k] = value;
      return;
    }
  }
  headers[key] = value;
}

function hasTool(tools: unknown, names: string[]): boolean {
  if (!Array.isArray(tools)) return false;
  for (const tool of tools) {
    if (typeof tool === "string") {
      if (names.includes(tool)) return true;
      continue;
    }
    if (!tool || typeof tool !== "object") continue;
    const t = tool as { name?: unknown; function?: { name?: unknown } };
    const name =
      typeof t.name === "string"
        ? t.name
        : typeof t.function?.name === "string"
          ? t.function.name
          : undefined;
    if (name && names.includes(name)) return true;
  }
  return false;
}

function isFreeZenProvider(ctx?: { model?: { provider?: unknown; baseUrl?: unknown } }): boolean {
  const provider = ctx?.model?.provider;
  if (provider === "opencode") return true;
  // Host-based fallback for custom model entries on the free Zen endpoint.
  if (provider !== "opencode-go" && typeof ctx?.model?.baseUrl === "string") {
    try {
      const url = new URL(ctx.model.baseUrl);
      return url.hostname === "opencode.ai" && !url.pathname.includes("/go");
    } catch {
      return false;
    }
  }
  return false;
}

export default function (pi: {
  on: (event: string, handler: (event: any, ctx?: any) => void) => void;
}) {
  let piSessionId: string | undefined;
  const remember = (_event: unknown, ctx?: { sessionManager?: { getSessionId: () => string } }) => {
    const id = ctx?.sessionManager?.getSessionId?.();
    if (id) piSessionId = id;
  };

  pi.on("session_start", remember);
  pi.on("before_agent_start", remember);

  pi.on(
    "before_provider_headers",
    (
      event: { headers: Record<string, string | null | undefined> },
      ctx?: { model?: { provider?: unknown; baseUrl?: unknown } },
    ) => {
      const headers = event.headers;
      // Free-tier Zen gate only. Never touch opencode-go or other providers:
      // stomping Authorization here overrides the real apiKey (OpenAI merges
      // defaultHeaders last) and yields "Missing API key".
      if (!headers || !isFreeZenProvider(ctx)) return;

      const session = piSessionId
        ? mapSessionId(piSessionId)
        : mapSessionId(randomBytes(16).toString("hex"));
      setHeader(headers, "User-Agent", OPENCODE_UA);
      setHeader(headers, "x-opencode-session", session);
      setHeader(headers, "x-opencode-client", "cli");
      setHeader(headers, "x-opencode-project", "global");
      setHeader(headers, "x-opencode-request", requestId());

      // Clear any leftover pi UUID session headers
      for (const k of Object.keys(headers)) {
        if (k.toLowerCase() === "x-session-id" || k.toLowerCase() === "session_id") {
          delete headers[k];
        }
      }
    },
  );

  pi.on(
    "before_provider_request",
    (
      event: {
        type: string;
        payload?: {
          tools?: unknown;
          stream?: unknown;
          [k: string]: unknown;
        };
      },
      ctx?: { model?: { provider?: unknown; baseUrl?: unknown } },
    ) => {
      const payload = event?.payload;
      if (!payload || typeof payload !== "object") return undefined;
      if (!isFreeZenProvider(ctx)) return undefined;

      // Gate requires a shell-type tool AND read in body.tools.
      if (!hasTool(payload.tools, ["bash", "shell"]) || !hasTool(payload.tools, ["read"])) {
        const tools = Array.isArray(payload.tools) ? [...payload.tools] : [];
        if (!hasTool(tools, ["bash", "shell"])) {
          tools.push({
            type: "function",
            function: {
              name: "bash",
              description: "Execute a bash command and return stdout/stderr.",
              parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] },
            },
          });
        }
        if (!hasTool(tools, ["read"])) {
          tools.push({
            type: "function",
            function: {
              name: "read",
              description: "Read a file from the filesystem.",
              parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
            },
          });
        }
        payload.tools = tools;
      }
      if (payload.stream === undefined) payload.stream = true;
      return payload;
    },
  );
}
