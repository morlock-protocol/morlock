// ─────────────────────────────────────────────────────────────────────────────
// Morlock Protocol v0.1 — Shared Types
// ─────────────────────────────────────────────────────────────────────────────

export type ParamType = "string" | "number" | "boolean" | "object" | "array";

export interface ParamSchema {
  type: ParamType;
  description?: string;
  required?: boolean;
  enum?: string[];
  default?: unknown;
}

export interface CommandSchema {
  description: string;
  params?: Record<string, ParamSchema>;
  returns?: string;
  examples?: Array<{
    params: Record<string, unknown>;
    result: unknown;
  }>;
}

export interface MorlockManifest {
  morlock: string;            // protocol version e.g. "0.1"
  name: string;              // human-readable site name
  baseUrl: string;           // canonical base URL
  endpoint: string;          // where to POST commands e.g. "/.well-known/morlock"
  auth?: MorlockAuth;
  commands: Record<string, CommandSchema>;
  rateLimit?: {
    requests: number;
    windowMs: number;
  };
  contact?: string;          // abuse/support email
}

export interface MorlockAuth {
  type: "none" | "bearer" | "apikey" | "oauth2";
  keyHeader?: string;        // for apikey: which header
  tokenUrl?: string;         // for oauth2
  scopes?: string[];
}

export interface MorlockRequest {
  command: string;
  args?: Record<string, unknown>;
  requestId?: string;        // for tracing
}

export interface MorlockResponse {
  ok: boolean;
  requestId?: string;
  result?: unknown;
  error?: {
    code: string;
    message: string;
  };
  meta?: {
    executionMs?: number;
    cached?: boolean;
  };
}

// Error codes
export const MorlockErrors = {
  UNKNOWN_COMMAND:    "UNKNOWN_COMMAND",
  INVALID_PARAMS:     "INVALID_PARAMS",
  AUTH_REQUIRED:      "AUTH_REQUIRED",
  FORBIDDEN:          "FORBIDDEN",
  RATE_LIMITED:       "RATE_LIMITED",
  INTERNAL_ERROR:     "INTERNAL_ERROR",
  COMMAND_FAILED:     "COMMAND_FAILED",
} as const;

export type MorlockErrorCode = typeof MorlockErrors[keyof typeof MorlockErrors];
