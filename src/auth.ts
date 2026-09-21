import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, chmodSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { AuthenticationProfileSchema, type AuthenticationProfile } from "./domain.js";

export type BrowserSessionCapture = { storageState(): Promise<unknown>; close(): Promise<void> };
export type BrowserSignIn = (target: string) => Promise<BrowserSessionCapture>;
export type AuthenticationChoice = "browser" | "saved_profile" | "public_only" | "cancel";
export class AuthenticationCancelledError extends Error { constructor() { super("Authentication cancelled by operator."); } }

/** Encrypted profile repository. Plain browser state is never returned by list(), logs, or HTML. */
export class EncryptedAuthenticationProfiles {
  constructor(private readonly directory: string, private readonly key: Buffer) { if (key.length !== 32) throw new Error("NOVA_AUTH_KEY must decode to exactly 32 bytes."); mkdirSync(directory, { recursive: true, mode: 0o700 }); }
  static fromEnvironment(directory = "data/auth"): EncryptedAuthenticationProfiles {
    const encoded = process.env.NOVA_AUTH_KEY;
    if (!encoded) throw new Error("NOVA_AUTH_KEY is required to store authentication profiles. Provide a base64 32-byte key; Nova never generates or prints one.");
    return new EncryptedAuthenticationProfiles(directory, Buffer.from(encoded, "base64"));
  }
  save(input: Omit<AuthenticationProfile, "id" | "createdAt">, state: unknown): AuthenticationProfile {
    const profile = AuthenticationProfileSchema.parse({ ...input, id: randomUUID(), createdAt: new Date().toISOString() });
    const nonce = randomBytes(12), cipher = createCipheriv("aes-256-gcm", this.key, nonce);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify({ profile, state }), "utf8"), cipher.final()]);
    const document = JSON.stringify({ v: 1, nonce: nonce.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") });
    this.atomicWrite(this.path(profile.id), document); return profile;
  }
  list(projectId: string, environment: string, target: string): AuthenticationProfile[] {
    const origin = new URL(target).origin;
    if (!existsSync(this.directory)) return [];
    return readdirSync(this.directory).filter((file: string) => file.endsWith(".profile")).map((file: string) => this.read(file.slice(0, -8)).profile).filter((profile) => profile.projectId === projectId && profile.environment === environment && profile.targetOrigin === origin && (!profile.expiresAt || Date.parse(profile.expiresAt) > Date.now()));
  }
  load(id: string, projectId: string, environment: string, target: string): unknown {
    const item = this.read(id); const expected = new URL(target).origin;
    if (item.profile.projectId !== projectId || item.profile.environment !== environment || item.profile.targetOrigin !== expected) throw new Error("Authentication profile does not match this project, environment, and target.");
    if (item.profile.expiresAt && Date.parse(item.profile.expiresAt) <= Date.now()) throw new Error("Authentication profile has expired."); return item.state;
  }
  private read(id: string): { profile: AuthenticationProfile; state: unknown } {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid authentication profile ID.");
    const raw = JSON.parse(readFileSync(this.path(id), "utf8")) as { v: number; nonce: string; tag: string; ciphertext: string };
    if (raw.v !== 1) throw new Error("Unsupported authentication profile version.");
    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(raw.nonce, "base64")); decipher.setAuthTag(Buffer.from(raw.tag, "base64"));
    const payload = JSON.parse(Buffer.concat([decipher.update(Buffer.from(raw.ciphertext, "base64")), decipher.final()]).toString("utf8"));
    return { profile: AuthenticationProfileSchema.parse(payload.profile), state: payload.state };
  }
  private path(id: string) { return join(this.directory, `${id}.profile`); }
  private atomicWrite(path: string, value: string) { const temp = `${path}.${randomBytes(6).toString("hex")}.tmp`; writeFileSync(temp, value, { mode: 0o600 }); renameSync(temp, path); chmodSync(path, 0o600); }
}
export async function resolveAuthentication(options: { choice: AuthenticationChoice; target: string; projectId: string; environment: string; profiles: EncryptedAuthenticationProfiles; profileId?: string; signIn?: BrowserSignIn }): Promise<{ method: "browser" | "saved_profile" | "public_only"; profile?: AuthenticationProfile; storageState?: unknown }> {
  if (options.choice === "cancel") throw new AuthenticationCancelledError();
  if (options.choice === "public_only") return { method: "public_only" };
  if (options.choice === "saved_profile") { if (!options.profileId) throw new Error("Select a saved authentication profile."); return { method: "saved_profile", storageState: options.profiles.load(options.profileId, options.projectId, options.environment, options.target) }; }
  if (!options.signIn) throw new Error("Browser sign-in is unavailable. Configure the approved browser authenticator.");
  const session = await options.signIn(options.target);
  try { const profile = options.profiles.save({ projectId: options.projectId, environment: options.environment, targetOrigin: new URL(options.target).origin, method: "browser" }, await session.storageState()); return { method: "browser", profile }; } finally { await session.close(); }
}
