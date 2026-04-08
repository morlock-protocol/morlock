// ─────────────────────────────────────────────────────────────────────────────
// Morlock Server — Auth enforcement
//
// The manifest declares auth requirements. This module enforces them.
// validateAuthConfig() throws at startup if auth is declared but no verifier
// is provided — fail-closed, not fail-open.
// enforceAuth() runs before every command dispatch.
// ─────────────────────────────────────────────────────────────────────────────

import type { CommandSchema, MorlockAuth } from "../shared/types";

export type AuthVerifier = (req: AuthVerifierInput) => Promise<AuthResult>;

export interface AuthVerifierInput {
  type: "bearer" | "apikey" | "oauth2";
  token: string;
  scopes?: string[];
  command: string;
}

export type AuthResult =
  | { ok: true; principal?: string }
  | { ok: false; reason: string };

export interface MorlockAuthOptions {
  /**
   * Required when manifest.auth.type !== "none".
   * Called before every command execution.
   * Throw or return { ok: false } to reject.
   */
  verifier?: AuthVerifier;

  /**
   * Override which commands require auth.
   * Default: all commands with safety !== "read" require auth when auth != "none".
   */
  requireAuthFor?: (command: CommandSchema, commandName: string) => boolean;
}

/**
 * Extract a bearer/apikey token from standard HTTP headers.
 */
export function extractToken(
  headers: Record<string, string | string[] | undefined>
): { type: "bearer" | "apikey"; token: string } | null {
  const authorization = Array.isArray(headers["authorization"])
    ? headers["authorization"][0]
    : headers["authorization"];

  if (authorization) {
    const [scheme, token] = authorization.split(" ");
    if (scheme?.toLowerCase() === "bearer" && token) {
      return { type: "bearer", token };
    }
  }

  const apiKey =
    headers["x-api-key"] ?? headers["x-morlock-api-key"];
  const key = Array.isArray(apiKey) ? apiKey[0] : apiKey;
  if (key) {
    return { type: "apikey", token: key };
  }

  return null;
}

/**
 * Core auth enforcement. Called before every command dispatch.
 *
 * - auth.type === "none"  → always passes
 * - auth.type !== "none"  → verifier MUST exist (validated at startup)
 * - Commands with safety === "read" + allowPublicRead === true may bypass auth
 */
export async function enforceAuth(
  headers: Record<string, string | string[] | undefined>,
  commandName: string,
  command: CommandSchema,
  auth: MorlockAuth,
  opts: MorlockAuthOptions
): Promise<{ ok: true; principal?: string } | { ok: false; status: 401 | 403; reason: string }> {
  if (auth.type === "none") {
    return { ok: true };
  }

  // Read-only bypass if explicitly opted in
  if (command.safety === "read" && auth.allowPublicRead === true) {
    return { ok: true };
  }

  const credential = extractToken(headers);
  if (!credential) {
    return {
      ok: false,
      status: 401,
      reason: "The gates are locked. Provide a Bearer token or X-Api-Key header.",
    };
  }

  // verifier is guaranteed to exist — validateAuthConfig() checked at startup
  const result = await opts.verifier!({
    type: credential.type,
    token: credential.token,
    scopes: command.requiredScopes,
    command: commandName,
  });

  if (!result.ok) {
    return { ok: false, status: 403, reason: result.reason };
  }

  return result;
}

/**
 * Call at server startup. Throws immediately if the manifest declares auth
 * but no verifier is provided — misconfiguration is a startup crash, not a
 * silent security hole.
 */
export function validateAuthConfig(
  auth: MorlockAuth,
  opts: MorlockAuthOptions
): void {
  if (auth.type !== "none" && !opts.verifier) {
    throw new Error(
      `[morlock] CONFIGURATION ERROR: auth.type is "${auth.type}" ` +
        `but no auth verifier was provided. ` +
        `Pass a verifier function in MorlockConfig, or set auth.type to "none" ` +
        `for public (unauthenticated) endpoints. ` +
        `Refusing to start with declared auth that is not enforced.`
    );
  }
}
