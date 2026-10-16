# MoneyMind API

Node.js + Express + PostgreSQL backend foundation for account authentication, private transactions, summaries, saved business ideas, and cash-flow forecasts.

## Deploy
1. Create a managed PostgreSQL database (for example Neon or Supabase).
2. Deploy the `backend` directory as a Node.js web service (Node 20+), with build command `npm install` and start command `npm start`.
3. Configure `DATABASE_URL`, a unique `JWT_SECRET` of at least 32 characters, `FRONTEND_ORIGIN` (the exact frontend origin), and `NODE_ENV=production` in the hosting dashboard. Never commit real secrets.
4. Visit `/api/health` on the deployed service; it should return `{ "status": "ok" }`.

## API
All routes are under `/api`. Register/login returns a token; send it on private requests as `Authorization: Bearer TOKEN`.
- `GET /api/health`
- `POST /api/auth/register` — `{ "email":"you@example.com", "password":"a-long-password", "displayName":"Name" }`
- `POST /api/auth/login` — `{ "email":"you@example.com", "password":"a-long-password" }`
- `GET /api/auth/me`
- `GET/POST /api/transactions`, `PATCH/DELETE /api/transactions/:id`
- `GET /api/summary`
- `GET/POST /api/ideas`, `DELETE /api/ideas/:id`
- `POST/GET /api/forecasts`, `DELETE /api/forecasts/:id`
- `GET/POST /api/budgets`, `PATCH/DELETE /api/budgets/:id` — category budgets and period-to-date spending
- `GET/POST /api/savings-goals`, `PATCH/DELETE /api/savings-goals/:id` — targets, progress, and target dates

Example transaction: `{ "kind":"expense", "amount":2500, "category":"Transport", "description":"Bus fare", "transaction_date":"2026-10-16" }`.

## Current limitations
The existing static `index.html` is not yet connected to this API; a follow-up frontend integration is required. AI provider integration, email verification/password reset, bank connections, and backup automation are not included. The static `index.html` still needs frontend integration to use these API routes. Never collect bank passwords, PINs, or one-time codes. Forecasts are estimates, not guarantees.

Passwords are bcrypt-hashed; SQL is parameterized; private queries are scoped to the signed-in user; rate limits and security headers are enabled. Production use still needs thorough testing, monitoring, verified account recovery, and operational security review.
