# Architecture

```text
Browser
  │
  ├── Next.js UI / visual seat grid
  │
  └── API routes
        ├── Auth (signed HTTP-only JWT)
        ├── Event inventory
        ├── Hold service ─────┐
        ├── Booking service   │ PostgreSQL transaction + row locks
        ├── Waitlist service ─┘
        └── Reconciliation cron
                │
                └── Expired holds/offers → AVAILABLE → FIFO offer

PostgreSQL
  Venue → Seat → ShowSeat ← Event
                    │
                 Booking
                    │
                BookingItem

Resend + QRCode
  confirmed booking → QR → email
```
