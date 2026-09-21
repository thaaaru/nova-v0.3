import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EncryptedAuthenticationProfiles, resolveAuthentication } from "../src/auth.js";

describe("encrypted authentication profiles", () => {
  it("encrypts browser state and only permits an exact project/environment/origin match", async () => {
    const directory = mkdtempSync(join(tmpdir(), "nova-auth-"));
    try {
      const profiles = new EncryptedAuthenticationProfiles(directory, Buffer.alloc(32, 7));
      const result = await resolveAuthentication({ choice: "browser", target: "https://app.example.test/login", projectId: "p1", environment: "staging", profiles, signIn: async () => ({ storageState: async () => ({ cookies: [{ name: "session", value: "private-value" }] }), close: async () => undefined }) });
      expect(result.profile?.id).toBeTruthy();
      const raw = readFileSync(join(directory, `${result.profile!.id}.profile`), "utf8");
      expect(raw).not.toContain("private-value");
      expect(profiles.load(result.profile!.id, "p1", "staging", "https://app.example.test/anything")).toEqual({ cookies: [{ name: "session", value: "private-value" }] });
      expect(() => profiles.load(result.profile!.id, "p1", "production", "https://app.example.test")).toThrow(/does not match/);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
  it("keeps public-only discovery free of a stored session", async () => {
    const directory = mkdtempSync(join(tmpdir(), "nova-auth-"));
    try { const profiles = new EncryptedAuthenticationProfiles(directory, Buffer.alloc(32, 1)); expect(await resolveAuthentication({ choice: "public_only", target: "https://app.example.test", projectId: "p", environment: "local", profiles })).toEqual({ method: "public_only" }); } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
