# SeatForge System Design

## 1. Core model
A `Venue` owns physical `Seat` records and each `Event` owns a `ShowSeat` snapshot. Snapshotting is deliberate: organisers can edit future venue templates without changing a live show's seat map. Each show seat has one state: `AVAILABLE`, `HELD`, or `BOOKED`.

## 2. Seat hold TTL
A hold writes `heldById`, a cryptographically random `holdToken`, and `holdExpiresAt`. The API validates the token at confirmation time. A scheduled reconciliation endpoint runs once a minute and clears expired holds. The read path also treats an expired hold as unavailable until reconciliation, while the hold transaction performs a final expiry check before claiming rows.

## 3. Concurrency prevention
The booking service runs in a PostgreSQL transaction and locks the requested `ShowSeat` rows using `FOR UPDATE`. It then verifies every seat is available or an expired hold. Only after all seats pass validation are they updated to `HELD`. Because the database serializes concurrent updates to the same rows, simultaneous requests cannot both claim the same seat. Booking repeats the same pattern and requires the exact hold token, so a stale client cannot steal or confirm someone else's lease.

## 4. Waitlist auto-assignment
Waitlist entries are ordered by `joinedAt` and receive one of `WAITING`, `OFFERED`, `CONVERTED`, `EXPIRED`, or `CANCELLED`. On cancellation, the service selects the oldest eligible entry for the seat category and creates a `WaitlistOffer` with an expiration time. The offer is a reservation opportunity, not a completed booking. Reconciliation expires old offers and attempts the next queue entry. This gives each customer a bounded window without blocking the whole category indefinitely.

## 5. Booking + QR
Once the hold is confirmed, a booking reference is generated and a QR code is produced from that reference. Only the opaque reference is encoded; sensitive customer data is not placed in the QR. Email delivery occurs after the database transaction succeeds, preventing a mail-provider outage from rolling back a valid booking.

## 6. Failure modes
If the client disconnects after creating a hold, TTL reconciliation recovers the seats. If a confirmation request is retried, the idempotency key returns the existing booking. If email fails, the booking remains visible in history and can be resent later. If a waitlist customer misses an offer, the next customer is promoted.
