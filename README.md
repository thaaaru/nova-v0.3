# Nova v0.3

Nova is a governed, local-first test orchestration tool. Its canonical flow is
`discover → plan → approve/reject → execute → report`. LLMs only produce
validated, evidence-grounded suggestions; services remain authoritative.

Run `pnpm nova test https://app.example.com`, or `pnpm nova` in an interactive
terminal. Set `NOVA_LLM_PROVIDER`, `NOVA_LLM_MODEL`, `NOVA_LLM_BASE_URL`, and
`NOVA_LLM_API_KEY` only when an approved model endpoint is available.
