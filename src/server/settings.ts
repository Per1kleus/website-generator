import "server-only";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { decryptSecret, encryptSecret } from "@/server/crypto";
import { isDesktop } from "@/server/runtime";

/**
 * Local settings for the desktop application.
 *
 * A hosted deployment has an operator who sets environment variables. The
 * desktop application does not: its user installs an .exe and is promised they
 * will never open a terminal. Their own API key still has to go somewhere, so
 * it goes here — in their profile, encrypted, on their machine.
 *
 * What this is not: a way to ship credentials. Nothing is stored in the
 * installer, nothing is bundled, and nothing here is ever sent to a client.
 * Values are read back only as "configured" flags and a last-four hint, so a
 * key cannot be recovered through the API that wrote it.
 *
 * Storage is a single encrypted file next to the database, using the same
 * AES-256-GCM helper as the Google tokens.
 */

/**
 * The allowlist. Only these may be written from inside the application; a
 * variable that is not named here cannot be set by a request, however the
 * request is shaped.
 */
export const EDITABLE_SETTINGS = [
  "ANTHROPIC_API_KEY",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "OLLAMA_HOST",
] as const;

export type SettingKey = (typeof EDITABLE_SETTINGS)[number];

/** Which of them are credentials, and so are never echoed back in full. */
const SECRET_KEYS = new Set<SettingKey>(["ANTHROPIC_API_KEY", "GOOGLE_CLIENT_SECRET"]);

function storePath(): string {
  const dir = process.env.WG_DATA_DIR ?? path.join(process.cwd(), "data");
  return path.join(dir, "settings.enc");
}

function readStore(): Partial<Record<SettingKey, string>> {
  const file = storePath();
  if (!existsSync(file)) return {};
  const plain = decryptSecret(readFileSync(file, "utf8").trim());
  if (!plain) return {};
  try {
    const parsed: unknown = JSON.parse(plain);
    if (!parsed || typeof parsed !== "object") return {};
    const out: Partial<Record<SettingKey, string>> = {};
    for (const key of EDITABLE_SETTINGS) {
      const value = (parsed as Record<string, unknown>)[key];
      if (typeof value === "string" && value) out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

function writeStore(values: Partial<Record<SettingKey, string>>): void {
  const file = storePath();
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, encryptSecret(JSON.stringify(values)), { mode: 0o600 });
}

/**
 * Copy stored settings into the process environment.
 *
 * Doing it here, once at startup, means every existing feature keeps reading
 * `process.env` exactly as it does on a server — there is one way to configure
 * the app, and the desktop simply fills it in from the user's own profile.
 *
 * An explicit environment variable always wins: someone who launches the app
 * with a key set meant that key.
 */
export function applyStoredSettings(): void {
  if (!isDesktop()) return;
  const stored = readStore();
  for (const [key, value] of Object.entries(stored)) {
    if (!process.env[key]) process.env[key] = value;
  }
}

export type SettingStatus = {
  key: SettingKey;
  configured: boolean;
  /** A recognisable tail for a credential, or the whole value when it is not one. */
  hint: string;
  /** True when the value came from the environment and cannot be edited here. */
  fromEnvironment: boolean;
};

function hintFor(key: SettingKey, value: string): string {
  if (!value) return "";
  if (!SECRET_KEYS.has(key)) return value;
  return value.length <= 4 ? "••••" : `••••${value.slice(-4)}`;
}

export function settingsStatus(): SettingStatus[] {
  const stored = readStore();
  return EDITABLE_SETTINGS.map((key) => {
    const value = process.env[key] ?? "";
    return {
      key,
      configured: Boolean(value),
      hint: hintFor(key, value),
      fromEnvironment: Boolean(value) && stored[key] !== value,
    };
  });
}

/**
 * Persist a change and apply it to the running process, so the user sees the
 * effect immediately rather than being told to restart the application.
 *
 * An empty string clears a setting. Unknown keys are ignored rather than
 * rejected, so a future field cannot become a way to write arbitrary variables.
 */
export function saveSettings(patch: Record<string, unknown>): void {
  const stored = readStore();
  for (const key of EDITABLE_SETTINGS) {
    if (!(key in patch)) continue;
    const raw = patch[key];
    if (typeof raw !== "string") continue;
    const value = raw.trim();
    if (value) {
      stored[key] = value;
      process.env[key] = value;
    } else {
      delete stored[key];
      delete process.env[key];
    }
  }
  writeStore(stored);
}
