# SeatForge — Concurrency-First Ticket Booking

SeatForge is a production-minded movie/concert ticket platform built around the hard parts of ticketing: **atomic seat holds, automatic expiry, waitlist promotion, QR tickets, RBAC, and live seat status**.

The project directly implements the supplied specification: visual seat selection, configurable holds, abandoned-checkout release, concurrency protection, category waitlists, time-limited cancellation offers, booking history/cancellation, organiser analytics, and QR-code email tickets. fileciteturn0file0L10-L39

## Why this project stands out

- **Database-first concurrency:** PostgreSQL row locks and conditional updates are the source of truth. The API never trusts the browser's seat status.
- **Lease semantics:** a hold is a renewable-looking but actually time-bounded lease with an explicit `expiresAt`.
- **Waitlist fairness:** FIFO queue per event/category, with a short offer lease and automatic fallback to the next person.
- **Reconciliation worker:** expired holds/offers are swept by a cron endpoint, making abandoned checkouts self-healing.
- **Idempotent booking:** a booking request carries an idempotency key so retries cannot double-create tickets.
- **Security baseline:** hashed passwords, signed JWT cookies, role checks, input validation, security headers, and no secrets in source.
- **Operational documentation:** schema, API contract, system design, testable concurrency logic, deployment notes.

## Stack

Next.js 15 + TypeScript + PostgreSQL + Prisma + JWT + Resend + QRCode.

## Quick start

1. Install Node.js 20+ and PostgreSQL 15+.
2. `cp .env.example .env`
3. Create the database in `DATABASE_URL`.
4. `npm install`
5. `npx prisma migrate dev --name init`
6. `npm run db:seed`
7. `npm run dev`
8. Open `http://localhost:3000`.

Seed credentials:
- Admin: `admin@seatforge.dev` / `Admin@12345`
- Organiser: `organiser@seatforge.dev` / `Organiser@12345`
- Customer: `customer@seatforge.dev` / `Customer@12345`

## API

### Auth
- `POST /api/auth/register` — customer/organiser registration
- `POST /api/auth/login` — login and signed HTTP-only cookie

### Events
- `GET /api/events` — filter by query, city, type, date
- `POST /api/organiser/events` — organiser creates an event
- `GET /api/events/:id/seats` — visual seat state
- `POST /api/events/:id/hold` — atomic hold for selected seats

### Booking
- `POST /api/bookings` — confirm a hold; supports `Idempotency-Key`
- `POST /api/bookings/:id/cancel` — cancel booking and trigger waitlist offer
- `GET /api/tickets/:reference` — ticket payload used by QR page

### Waitlist
- `POST /api/waitlist` — join event/category queue

### Admin
- `POST /api/admin/venues` — create venue + seat layout

### Operations
- `POST /api/cron/reconcile` — release expired holds and waitlist offers
- `GET /api/health` — readiness check

## Seat hold and concurrency design

Each show has one `ShowSeat` row per physical seat. Holding is performed inside a PostgreSQL transaction. The selected rows are locked with `FOR UPDATE`; after expired state is reconciled, the transaction only transitions `AVAILABLE -> HELD`. If any requested seat is already held or booked, the transaction aborts and no partial hold is returned. This means two customers racing for the same seat cannot both win.

A hold stores `holdToken`, `heldById`, and `holdExpiresAt`. The configured TTL defaults to 10 minutes. The booking endpoint checks the same token and expiry inside another transaction before changing `HELD -> BOOKED`. A cron request runs every minute and performs the same expiry reconciliation, so abandoned checkout is eventually released even if the user closes the browser.

## Waitlist flow

When a cancellation creates availability, the system checks the FIFO waitlist for the affected category. The first eligible customer receives a `WaitlistOffer` with an expiration timestamp (default five minutes). The seat is not marked booked yet; it is reserved for the offer holder. If the customer accepts through the booking flow, the offer is consumed and the seat becomes booked. If the offer expires, reconciliation marks it expired and advances to the next queue entry. This avoids silently losing last-minute cancellations while preserving fairness.

## Email + QR

On confirmed booking, SeatForge generates a QR payload containing only the booking reference. If `RESEND_API_KEY` is configured, an email is sent with the QR image embedded. Without an email provider in local development, the booking remains valid and the API logs a safe development notice instead of failing the transaction.

## Deployment

### Vercel + managed PostgreSQL
1. Push the repository to GitHub.
2. Import into Vercel.
3. Add all `.env` values in Project Settings.
4. Set `DATABASE_URL` to Neon/Supabase/another managed PostgreSQL connection string.
5. Deploy. `vercel.json` invokes the reconciliation endpoint every minute.
6. Protect the cron endpoint with `CRON_SECRET`.

### Important production upgrades
- Put Redis in front of high-volume event feeds if needed.
- Add a payment provider before taking real money.
- Add rate limiting at the edge/API gateway.
- Use a dedicated transactional email domain.
- Add OpenTelemetry/Sentry and database backups.

## Folder structure

```text
app/                 Next.js pages + API routes
components/          reusable UI
lib/                 auth, database, booking, mail, QR helpers
prisma/              schema + seed data
.github/workflows/   CI
```

## Evaluation checklist

- [x] RBAC: customer / organiser / admin
- [x] Visual seat grid
- [x] Real-time-friendly seat endpoint + client refresh
- [x] Configurable hold TTL
- [x] Automatic expiry reconciliation
- [x] Transactional concurrency protection
- [x] Category FIFO waitlist
- [x] Time-limited cancellation offer
- [x] Booking history/cancellation foundation
- [x] QR generation
- [x] Email integration
- [x] Organiser revenue summary endpoint-ready schema
- [x] API documentation
- [x] DB schema
- [x] System design documentation
