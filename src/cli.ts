#!/usr/bin/env node
import { Command } from "commander";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { EncryptedAuthenticationProfiles, resolveAuthentication } from "./auth.js";
import { createPlaywrightBrowserSignIn, probeAuthenticationRequired } from "./browser-auth.js";
import { normalizePnpmArgv } from "./cli-argv.js";
import { discoverApplication } from "./discovery.js";
import { buildDiscoveryEvidence, suggestDeterministicTests } from "./planning.js";
import { startApprovalServer } from "./approval-server.js";
import { spawn } from "node:child_process";
import { executeApprovedReadOnly } from "./execution.js";

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
  const auth = authenticationRequired ? await handleAuthentication(target, options.project, options.environment) : { storageState: undefined, label: "Not required" };
  if (!auth) return;
  process.stdout.write(`Authentication  ${auth.label}\nNOVA  Discovering application\n`);
  const discovery = await discoverApplication({ target, storageState: auth.storageState, onProgress: (message) => process.stdout.write(`  ${message}\n`) });
  process.stdout.write(`\nDiscovery complete\nPages          ${discovery.pages}\nRoutes         ${discovery.routes.length}\nHeadings       ${discovery.headings.length}\nAuthentication ${discovery.authenticationUsed ? "Saved session" : "Public only"}\n`);
  const evidence = buildDiscoveryEvidence(target, discovery);
  const plan = suggestDeterministicTests(target, options.environment, [new URL(target).hostname], discovery, evidence);
  const review = await startApprovalServer(plan, { applicationName: new URL(target).hostname, target, environment: options.environment, scope: [new URL(target).hostname] });
  openBrowser(review.url);
  process.stdout.write(`\nSuggested tests  ${plan.cases.length}\nEvidence          ${evidence.evidence.length}\nApproval review   ${review.url}\nWaiting for approval in your browser…\n`);
  const decision = await review.wait();
  process.stdout.write(`Approval  ${decision.submission.decision}\n`);
  if (decision.submission.decision === "approved") await requestExecution(plan, decision.submission.selectedTestCaseIds, auth.storageState);
});
program.action(() => { if (!stdin.isTTY) missingTarget(); if (shouldShowBanner({ noBanner: !program.opts().banner, json: program.opts().json })) process.stdout.write(`${BANNER}\n\n`); process.stdout.write("Target URL: "); });
program.parseAsync(normalizePnpmArgv(process.argv)).catch((error) => { if (error.message !== "NOVA_INPUT_REQUIRED") { process.stderr.write(`${error.message}\n`); process.exitCode = 1; } });

async function handleAuthentication(target: string, projectId: string, environment: string): Promise<{ storageState?: unknown; label: string } | undefined> {
  if (!stdin.isTTY) throw new Error("NOVA_AUTH_INTERACTION_REQUIRED: Authentication requires an interactive terminal; use a pre-approved profile in CI.");
  const profiles = EncryptedAuthenticationProfiles.fromEnvironment();
  const saved = profiles.list(projectId, environment, target);
  const io = createInterface({ input: stdin, output: stdout });
  try {
    stdout.write(`\nAuthentication required\n[Enter] Sign in using browser\n[P] Use saved authentication profile${saved.length ? ` (${saved.length} available)` : " (none)"}\n[G] Discover public areas only\n[Esc/Q] Cancel\n`);
    const answer = (await io.question("Choice: ")).trim().toLowerCase();
    if (answer === "g") { await resolveAuthentication({ choice: "public_only", target, projectId, environment, profiles }); return { label: "Public areas only" }; }
    if (answer === "p") {
      if (!saved.length) throw new Error("No matching saved authentication profile exists.");
      const selected = saved[0]!;
      const result = await resolveAuthentication({ choice: "saved_profile", target, projectId, environment, profiles, profileId: selected.id });
      return { storageState: result.storageState, label: `Saved profile ${selected.id.slice(0, 8)} reused` };
    }
    if (answer === "q" || answer === "\u001b") { await resolveAuthentication({ choice: "cancel", target, projectId, environment, profiles }); return; }
    const result = await resolveAuthentication({
      choice: "browser", target, projectId, environment, profiles,
      signIn: createPlaywrightBrowserSignIn({
        waitForCompletion: async (message) => { stdout.write(`${message}\n`); await io.question("Press Enter when complete: "); },
      }),
    });
    return { storageState: result.storageState, label: "Browser session saved securely" };
  } finally { io.close(); }
}

async function requestExecution(plan: import("./domain.js").TestPlan, selected: string[], storageState?: unknown): Promise<void> {
  const io = createInterface({ input: stdin, output: stdout });
  try {
    const answer = (await io.question(`\nTest plan approved\nApproved  ${selected.length}\n\n[Enter] Run approved tests\n[S] Save for later\nChoice: `)).trim().toLowerCase();
    if (answer === "s" || answer === "q") { stdout.write("Execution request  Saved for later\n"); return; }
    const result = await executeApprovedReadOnly(plan, selected, storageState);
    stdout.write(`Execution complete\nPassed  ${result.passed}\nFailed  ${result.failed}\n`);
  } finally { io.close(); }
}

function openBrowser(url: string): void {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, { stdio: "ignore", detached: true });
  child.on("error", () => process.stdout.write(`Open this approval URL manually: ${url}\n`));
  child.unref();
}
