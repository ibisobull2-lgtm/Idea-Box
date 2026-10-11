# MoneyMind: production and scale-up roadmap

## Current state (be explicit)
MoneyMind is currently a static browser prototype. Transaction, budget, goal, theme, quote, country, and language preferences are stored in the user's browser. There is no server-side account system, shared database, bank connection, server-side market research, or cloud sync. A GitHub Pages deployment can serve the front end, but it does not provide the backend required for a large multi-user financial product.

## Work completed in the prototype
- Business Idea Analyser input validation, scenario estimates, and clearer disclosure that its planning-readiness score is not a probability of business success.
- Local JSON backup export and validated backup restore, with confirmation before replacing existing transactions/budget/goal.
- Backup includes the selected country/language preferences and theme/quote preferences.
- Clear disclosure that browser data is local and not cloud-synced.

## Required before public production launch

### 1. Product and financial-model validation
- Interview target users and test whether they return to the product after the first session.
- Compare estimates against manually checked sample cases, including zero sales, high costs, negative net results, and break-even calculations.
- Label all forecasts as assumptions/scenarios, not guarantees or financial advice.
- For the idea analyser, add editable assumptions, sensitivity analysis, evidence sources, competitor research, customer validation, and confidence/coverage indicators. Do not imply market validation unless actual evidence has been gathered.
- Have a qualified accountant/financial-model reviewer check calculation logic before presenting results as decision-grade.

### 2. Backend and data architecture
Use a maintained server framework and a managed relational database (for example, PostgreSQL). Separate the browser UI from server APIs.
- Authentication: use a proven identity provider; support secure account recovery and multi-factor authentication where appropriate.
- Authorization: every API request must enforce ownership at the server. Never trust a user ID supplied by the browser.
- Data: versioned migrations, input schemas, parameterized queries, encryption in transit and at rest, and tenant isolation.
- Backups: automated encrypted backups, retention policy, and tested restoration drills.
- Portability: export and delete account data, with a documented retention/deletion policy.
- Keep secrets in the deployment provider's secret manager; never put database credentials, API keys, or bank-provider secrets in HTML or Git.
- Do not store bank credentials. If bank connectivity is added, use a regulated provider's authorization flow and obtain specialist legal/security review first.

### 3. Reliability and scale
Do not claim a 300-million-user capacity until it is measured. Scale is a tested property, not a front-end feature.
- Start with a stateless API behind a load balancer and a managed database. Add a CDN for static assets.
- Add rate limits, abuse controls, request timeouts, retries with backoff, idempotency for writes, and bounded payload sizes.
- Add structured logs, metrics, tracing, uptime/error alerts, and a documented incident response process.
- Define service-level objectives and recovery-time/recovery-point objectives.
- Load-test realistic read/write patterns, account for database connection limits, and test failure modes before increasing traffic.
- Scale in stages based on real usage, latency, error rates, and cost per active user. Do not provision infrastructure for 300 million users before validating demand.

### 4. Security and privacy
- Threat-model account takeover, cross-account data access, injection, malicious uploads, abuse, and data leakage.
- Use dependency scanning, secret scanning, code review, automated tests, and periodic independent security review.
- Minimize collected personal data and avoid collecting sensitive financial information that the product does not need.
- Publish a clear privacy notice, terms, contact/support route, data-retention rules, and an incident/breach response plan.
- Review applicable privacy, consumer-protection, and financial-services requirements in each launch market.

### 5. International readiness
- Translate every visible label, validation message, chart label, email, and help page; setting a language attribute alone is not translation.
- Validate country-to-currency mappings with a maintained data source. Currency formatting is not foreign-exchange conversion.
- Keep currency amounts as decimal-safe values with an explicit currency code in backend records. Do not assume all users use two decimal places.
- Add date/time-zone handling, right-to-left layout testing, accessibility checks, and country-specific legal review.
- Do not infer tax rules or bank availability solely from the user's country selection.

### 6. Release gates
Before calling the app production-ready, require:
- Automated unit and integration tests for calculations, auth, permissions, and backup/restore.
- Browser tests on supported desktop and mobile sizes.
- Accessibility checks and a manual keyboard/screen-reader review.
- Dependency and secret scans; no critical/high unresolved security findings.
- Successful backup restoration and disaster-recovery rehearsal.
- A monitored, limited beta with a rollback plan.
- Written approval of privacy, terms, support, and financial disclaimers.

## Suggested staged rollout
1. **Prototype:** local-only use, clear disclosures, backup/restore, manual testing.
2. **Private beta:** real backend, accounts, database, server-side authorization, monitoring, and support.
3. **Public launch:** security review, localization, privacy/legal review, load tests, backups, and incident response.
4. **Growth:** measure actual usage, improve reliability, and scale the bottlenecks shown by monitoring.
5. **Very large scale:** architecture review and staged capacity testing based on measured workloads. No user-count guarantee should be made without evidence.

## Current known limitations
- This repository alone cannot provision cloud infrastructure, create a database, configure DNS, or securely activate third-party services.
- No production backend or real bank integration has been added by this documentation.
- The browser prototype should not be used as the sole record of important financial information.
- The Business Idea Analyser uses user-entered assumptions; it does not independently verify customer demand, competitors, pricing, or market size.
