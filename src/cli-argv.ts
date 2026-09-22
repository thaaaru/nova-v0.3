/** Normalizes `pnpm script -- command` before Commander sees child-command options. */
export function normalizePnpmArgv(argv: string[]): string[] {
  return argv[2] === "--" ? [argv[0]!, argv[1]!, ...argv.slice(3)] : argv;
}
