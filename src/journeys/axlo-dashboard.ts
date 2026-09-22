export const axloDashboardJourney = {
  id: "axlo-dashboard-review-v1",
  title: "Review the Axlo POS dashboard",
  target: "https://qa.axlopos.com",
  environment: "qa",
  accountRole: "Restaurant Owner",
  allowedRoutes: ["/dashboard", "/tables", "/kitchen", "/calendar", "/pos/takeaway"],
  readOnlyActions: ["Open dashboard", "Read KPI cards", "Inspect visible summaries", "Follow allowed dashboard links", "Collect console and failed-network evidence"],
  prohibitedActions: ["Create, edit, send, cancel, or pay for orders", "Change tables, tickets, reservations, users, settings, products, or themes", "Download or export customer data", "Call POST, PUT, PATCH, or DELETE except approved login"],
  assertions: {
    "/dashboard": [["Open Tables"], ["Bill Requested"], ["Kitchen Queue"], ["Takeaway Ready"]],
    "/tables": [["Tables"]],
    "/kitchen": [["Kitchen"]],
    "/calendar": [["Calendar"]],
    "/pos/takeaway": [["Takeaway"]],
  },
} as const;

export type JourneyAuditEvent = { timestamp: string; route: string; action: string; result: "passed" | "failed" | "blocked"; detail?: string };

/** Rejects a requested route or non-read-only HTTP method before browser work begins. */
export function assertAxloDashboardScope(route: string, method = "GET"): void {
  const path = new URL(route, axloDashboardJourney.target).pathname;
  if (!axloDashboardJourney.allowedRoutes.includes(path as typeof axloDashboardJourney.allowedRoutes[number])) throw new Error(`Blocked by journey scope: ${path}`);
  if (method !== "GET") throw new Error(`Blocked mutating method: ${method}`);
}
