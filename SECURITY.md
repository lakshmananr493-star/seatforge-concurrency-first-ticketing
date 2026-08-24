# Security notes

- Never commit `.env` or provider keys.
- Rotate `JWT_SECRET` and `CRON_SECRET` before production.
- Use HTTPS in production.
- Add edge rate limiting for login, hold and booking endpoints.
- Add a payment provider with webhook verification before accepting real money.
- QR payloads contain only an opaque booking reference.
- Database concurrency is enforced server-side; client seat state is never authoritative.
