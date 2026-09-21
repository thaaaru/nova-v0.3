#!/usr/bin/env node
import { Command } from "commander";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { EncryptedAuthenticationProfiles, resolveAuthentication } from "./auth.js";
import { createPlaywrightBrowserSignIn, probeAuthenticationRequired } from "./browser-auth.js";

export const BANNER = ` _   _   ___   __     __    _
| \\ | | / _ \\  \\ \\   / /   / \\
|  \\| || | | |  \\ \\ / /   / _ \\
| |\\  || |_| |   \\ V /   / ___ \\
|_| \\_| \\___/     \\_/   /_/   \\_\\

       Discover > Approve > Execute`;

export function shouldShowBanner(options: { noBanner?: boolean; json?: boolean }) { return !options.noBanner && !options.json && Boolean(stdout.isTTY && stdin.isTTY) && !process.env.CI; }
function missingTarget(): never { const error = { code: "NOVA_INPUT_REQUIRED", missingFields: ["target"], acceptedFlags: ["nova test <url>", "nova test --target <url>"], example: "nova test https://app.example.com" }; process.stderr.write(`${JSON.stringify(error)}\n`); process.exitCode = 2; throw new Error(error.code); }

const program = new Command().name("nova").description("Governed local-first web testing.");
program.option("--no-banner", "Suppress startup banner").option("--json", "Machine-readable output");
program.command("test [url]").option("--target <url>").option("--environment <environment>", "Environment label", "qa").option("--project <project>", "Project ID", "default").option("--require-auth", "Always offer authentication instead of relying on entry probing", false).action(async (url: string | undefined, options: { target?: string; environment: string; project: string; requireAuth: boolean }, command: Command) => {
  const root = command.parent!.opts<{ banner: boolean; json: boolean }>(); const target = options.target ?? url;
  if (!target) { if (!stdin.isTTY) missingTarget(); process.stdout.write("Target URL: "); return; }
  new URL(target); if (shouldShowBanner({ noBanner: !root.banner, json: root.json })) process.stdout.write(`${BANNER}\n\n`);
  if (root.json) { process.stdout.write(JSON.stringify({ status: "NEW", target }) + "\n"); return; }
  process.stdout.write(`NOVA  Probing entry context\nTarget  ${target}\n`);
  const authenticationRequired = options.requireAuth || await probeAuthenticationRequired(target);
  if (!authenticationRequired) { process.stdout.write("Authentication  Not required\nNext            Discover public application areas\n"); return; }
  await handleAuthentication(target, options.project, options.environment);
});
program.action(() => { if (!stdin.isTTY) missingTarget(); if (shouldShowBanner({ noBanner: !program.opts().banner, json: program.opts().json })) process.stdout.write(`${BANNER}\n\n`); process.stdout.write("Target URL: "); });
program.parseAsync().catch((error) => { if (error.message !== "NOVA_INPUT_REQUIRED") { process.stderr.write(`${error.message}\n`); process.exitCode = 1; } });

async function handleAuthentication(target: string, projectId: string, environment: string): Promise<void> {
  if (!stdin.isTTY) throw new Error("NOVA_AUTH_INTERACTION_REQUIRED: Authentication requires an interactive terminal; use a pre-approved profile in CI.");
  const profiles = EncryptedAuthenticationProfiles.fromEnvironment();
  const saved = profiles.list(projectId, environment, target);
  const io = createInterface({ input: stdin, output: stdout });
  try {
    stdout.write(`\nAuthentication required\n[Enter] Sign in using browser\n[P] Use saved authentication profile${saved.length ? ` (${saved.length} available)` : " (none)"}\n[G] Discover public areas only\n[Esc/Q] Cancel\n`);
    const answer = (await io.question("Choice: ")).trim().toLowerCase();
    if (answer === "g") { await resolveAuthentication({ choice: "public_only", target, projectId, environment, profiles }); stdout.write("Authentication  Public areas only\nNext            Discover application\n"); return; }
    if (answer === "p") {
      if (!saved.length) throw new Error("No matching saved authentication profile exists.");
      const selected = saved[0]!;
      await resolveAuthentication({ choice: "saved_profile", target, projectId, environment, profiles, profileId: selected.id });
      stdout.write(`Authentication  Saved profile ${selected.id.slice(0, 8)} reused\nNext            Discover application\n`); return;
    }
    if (answer === "q" || answer === "\u001b") { await resolveAuthentication({ choice: "cancel", target, projectId, environment, profiles }); return; }
    await resolveAuthentication({
      choice: "browser", target, projectId, environment, profiles,
      signIn: createPlaywrightBrowserSignIn({
        waitForCompletion: async (message) => { stdout.write(`${message}\n`); await io.question("Press Enter when complete: "); },
      }),
    });
    stdout.write("Authentication  Browser session saved securely\nNext            Discover application\n");
  } finally { io.close(); }
}
