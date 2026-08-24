import { db } from './db';
import {
  Prisma,
  SeatStatus,
  BookingStatus,
  SeatCategory,
  WaitlistStatus,
} from '@prisma/client';
import crypto from 'node:crypto';

export const holdTTL = () =>
  Number(process.env.HOLD_TTL_SECONDS || 600);

export const offerTTL = () =>
  Number(process.env.WAITLIST_OFFER_TTL_SECONDS || 300);

export function priceFor(
  category: SeatCategory,
  event: {
    premiumPrice: number;
    standardPrice: number;
    vipPrice: number;
  }
) {
  return category === SeatCategory.PREMIUM
    ? event.premiumPrice
    : category === SeatCategory.VIP
      ? event.vipPrice
      : event.standardPrice;
}

/**
 * Release expired seat holds and waitlist offers.
 */
export async function expireHolds(tx = db) {
  const now = new Date();

  await tx.showSeat.updateMany({
    where: {
      status: SeatStatus.HELD,
      holdExpiresAt: {
        lt: now,
      },
    },
    data: {
      status: SeatStatus.AVAILABLE,
      heldById: null,
      holdToken: null,
      holdExpiresAt: null,
    },
  });

  await tx.waitlistOffer.updateMany({
    where: {
      status: WaitlistStatus.OFFERED,
      expiresAt: {
        lt: now,
      },
    },
    data: {
      status: WaitlistStatus.EXPIRED,
    },
  });

  await tx.waitlistEntry.updateMany({
    where: {
      status: WaitlistStatus.OFFERED,
      offers: {
        some: {
          status: WaitlistStatus.EXPIRED,
        },
      },
    },
    data: {
      status: WaitlistStatus.WAITING,
    },
  });
}

/**
 * Temporarily hold one or more seats.
 *
 * The requested ShowSeat rows are locked with SELECT ... FOR UPDATE
 * before their availability is checked.
 */
export async function holdSeats(
  eventId: string,
  userId: string,
  seatIds: string[]
) {
  if (!seatIds.length || seatIds.length > 10) {
    throw new Error('Select 1-10 seats');
  }

  return db.$transaction(async tx => {
    await expireHolds(tx);

    const seats = await tx.showSeat.findMany({
      where: {
        eventId,
        seatId: {
          in: seatIds,
        },
      },
      include: {
        seat: true,
        event: true,
      },
      orderBy: {
        seatId: 'asc',
      },
    });

    if (seats.length !== seatIds.length) {
      throw new Error('One or more seats do not exist');
    }

    const ids = seats.map(seat => seat.id);

    /*
     * Lock requested seats.
     *
     * If two users try to hold the same seat concurrently,
     * one transaction obtains the lock first. The other waits
     * and then checks the latest seat state.
     */
    await tx.$queryRaw`
      SELECT id
      FROM "ShowSeat"
      WHERE id IN (${Prisma.join(ids)})
      ORDER BY id
      FOR UPDATE
    `;

    const fresh = await tx.showSeat.findMany({
      where: {
        id: {
          in: ids,
        },
      },
      include: {
        seat: true,
        event: true,
      },
    });

    if (
      fresh.some(
        seat =>
          seat.status === SeatStatus.BOOKED ||
          (seat.status === SeatStatus.HELD &&
            seat.heldById !== userId)
      )
    ) {
      throw new Error('SEATS_UNAVAILABLE');
    }

    const token = crypto.randomBytes(24).toString('hex');

    const expires = new Date(
      Date.now() + holdTTL() * 1000
    );

    await tx.showSeat.updateMany({
      where: {
        id: {
          in: ids,
        },
      },
      data: {
        status: SeatStatus.HELD,
        heldById: userId,
        holdToken: token,
        holdExpiresAt: expires,
      },
    });

    return {
      holdToken: token,
      expiresAt: expires,

      seats: fresh.map(seat => ({
        id: seat.seatId,
        row: seat.seat.rowLabel,
        number: seat.seat.seatNumber,
        category: seat.seat.category,
        price: priceFor(
          seat.seat.category,
          seat.event
        ),
      })),
    };
  });
}

/**
 * Confirm a previously created seat hold.
 *
 * Uses idempotency protection and row-level locking
 * to prevent duplicate bookings and concurrent seat races.
 */
export async function confirmBooking(
  userId: string,
  eventId: string,
  holdToken: string,
  idempotencyKey: string
) {
  return db.$transaction(async tx => {
    /*
     * Idempotency protection.
     */
    const old = await tx.booking.findUnique({
      where: {
        idempotencyKey,
      },
    });

    if (old) {
      return old;
    }

    const now = new Date();

    await expireHolds(tx);

    /*
     * Find seats belonging to this hold.
     */
    const candidateSeats = await tx.showSeat.findMany({
      where: {
        eventId,
        holdToken,
        status: SeatStatus.HELD,
      },
      select: {
        id: true,
      },
    });

    if (!candidateSeats.length) {
      throw new Error('HOLD_EXPIRED');
    }

    const seatIds = candidateSeats.map(
      seat => seat.id
    );

    /*
     * Lock seats before checking them again.
     */
    await tx.$queryRaw`
      SELECT id
      FROM "ShowSeat"
      WHERE id IN (${Prisma.join(seatIds)})
      ORDER BY id
      FOR UPDATE
    `;

    /*
     * Re-read the locked seats.
     */
    const seats = await tx.showSeat.findMany({
      where: {
        id: {
          in: seatIds,
        },
        eventId,
        holdToken,
        status: SeatStatus.HELD,
      },
      include: {
        seat: true,
        event: true,
      },
    });

    /*
     * Verify:
     * 1. All seats still exist.
     * 2. All seats still belong to this hold.
     * 3. The hold belongs to this user.
     * 4. The hold has not expired.
     */
    if (
      !seats.length ||
      seats.length !== seatIds.length ||
      seats.some(
        seat =>
          seat.heldById !== userId ||
          !seat.holdExpiresAt ||
          seat.holdExpiresAt <= now
      )
    ) {
      throw new Error('HOLD_EXPIRED');
    }

    const reference =
      `SF-${new Date().getFullYear()}-` +
      crypto
        .randomBytes(5)
        .toString('hex')
        .toUpperCase();

    const total = seats.reduce(
      (sum, seat) =>
        sum +
        priceFor(
          seat.seat.category,
          seat.event
        ),
      0
    );

    /*
     * Create booking while seats are locked.
     */
    const booking = await tx.booking.create({
      data: {
        reference,
        userId,
        eventId,
        totalAmount: total,
        idempotencyKey,
        qrPayload: reference,

        items: {
          create: seats.map(seat => ({
            showSeatId: seat.id,
            price: priceFor(
              seat.seat.category,
              seat.event
            ),
          })),
        },
      },
    });

    /*
     * Convert held seats into booked seats.
     */
    await tx.showSeat.updateMany({
      where: {
        id: {
          in: seatIds,
        },
      },
      data: {
        status: SeatStatus.BOOKED,
        bookedAt: now,
        heldById: null,
        holdToken: null,
        holdExpiresAt: null,
      },
    });

    return booking;
  });
}

/**
 * Cancel a confirmed booking and offer released seats
 * to the earliest matching waitlist customer.
 */
export async function cancelBooking(
  userId: string,
  bookingId: string
) {
  return db.$transaction(async tx => {
    const booking =
      await tx.booking.findFirst({
        where: {
          id: bookingId,
          userId,
          status: BookingStatus.CONFIRMED,
        },

        include: {
          items: {
            include: {
              showSeat: {
                include: {
                  seat: true,
                },
              },
            },
          },
          event: true,
        },
      });

    if (!booking) {
      throw new Error('BOOKING_NOT_FOUND');
    }

    await tx.booking.update({
      where: {
        id: bookingId,
      },
      data: {
        status: BookingStatus.CANCELLED,
        cancelledAt: new Date(),
      },
    });

    for (const item of booking.items) {
      /*
       * Release the seat.
       */
      await tx.showSeat.update({
        where: {
          id: item.showSeatId,
        },
        data: {
          status: SeatStatus.AVAILABLE,
          bookedAt: null,
        },
      });

      /*
       * Find the earliest waiting customer
       * for this seat category.
       */
      const entry =
        await tx.waitlistEntry.findFirst({
          where: {
            eventId: booking.eventId,
            category:
              item.showSeat.seat.category,
            status: WaitlistStatus.WAITING,
          },
          orderBy: {
            joinedAt: 'asc',
          },
        });

      if (entry) {
        const expiresAt = new Date(
          Date.now() + offerTTL() * 1000
        );

        /*
         * Create time-limited waitlist offer.
         */
        await tx.waitlistOffer.create({
          data: {
            entryId: entry.id,
            userId: entry.userId,
            eventId: booking.eventId,
            showSeatId: item.showSeatId,
            expiresAt,
          },
        });

        /*
         * Mark waitlist entry as offered.
         */
        await tx.waitlistEntry.update({
          where: {
            id: entry.id,
          },
          data: {
            status: WaitlistStatus.OFFERED,
          },
        });

        /*
         * Temporarily hold the seat for the
         * waitlisted customer.
         */
        await tx.showSeat.update({
          where: {
            id: item.showSeatId,
          },
          data: {
            status: SeatStatus.HELD,
            heldById: entry.userId,
            holdToken: `OFFER:${entry.id}`,
            holdExpiresAt: expiresAt,
          },
        });
      }
    }

    return booking;
  });
}
