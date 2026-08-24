import { db } from './db';
import { SeatStatus, BookingStatus, SeatCategory, WaitlistStatus } from '@prisma/client';
import crypto from 'node:crypto';
export const holdTTL=()=>Number(process.env.HOLD_TTL_SECONDS||600);
export const offerTTL=()=>Number(process.env.WAITLIST_OFFER_TTL_SECONDS||300);
export function priceFor(category:SeatCategory,event:{premiumPrice:number;standardPrice:number;vipPrice:number}){return category===SeatCategory.PREMIUM?event.premiumPrice:category===SeatCategory.VIP?event.vipPrice:event.standardPrice}
export async function expireHolds(tx= db){
 const now=new Date();
 await tx.showSeat.updateMany({where:{status:SeatStatus.HELD,holdExpiresAt:{lt:now}},data:{status:SeatStatus.AVAILABLE,heldById:null,holdToken:null,holdExpiresAt:null}});
 await tx.waitlistOffer.updateMany({where:{status:WaitlistStatus.OFFERED,expiresAt:{lt:now}},data:{status:WaitlistStatus.EXPIRED}});
 await tx.waitlistEntry.updateMany({where:{status:WaitlistStatus.OFFERED,offers:{some:{status:WaitlistStatus.EXPIRED}}},data:{status:WaitlistStatus.WAITING}});
}
export async function holdSeats(eventId:string,userId:string,seatIds:string[]){
 if(!seatIds.length||seatIds.length>10)throw new Error('Select 1-10 seats');
 return db.$transaction(async tx=>{
   await expireHolds(tx);
   const seats=await tx.showSeat.findMany({where:{eventId,seatId:{in:seatIds}},include:{seat:true,event:true},orderBy:{seatId:'asc'}});
   if(seats.length!==seatIds.length)throw new Error('One or more seats do not exist');
   const ids=seats.map(s=>s.id);
   await tx.$queryRaw`SELECT id FROM "ShowSeat" WHERE id IN (${ids.join(',')}) FOR UPDATE`;
   const fresh=await tx.showSeat.findMany({where:{id:{in:ids}},include:{seat:true,event:true}});
   if(fresh.some(s=>s.status===SeatStatus.BOOKED || (s.status===SeatStatus.HELD&&s.heldById!==userId))) throw new Error('SEATS_UNAVAILABLE');
   const token=crypto.randomBytes(24).toString('hex'); const expires=new Date(Date.now()+holdTTL()*1000);
   await tx.showSeat.updateMany({where:{id:{in:ids}},data:{status:SeatStatus.HELD,heldById:userId,holdToken:token,holdExpiresAt:expires}});
   return {holdToken:token,expiresAt:expires,seats:fresh.map(s=>({id:s.seatId,row:s.seat.rowLabel,number:s.seat.seatNumber,category:s.seat.category,price:priceFor(s.seat.category,s.event)}))};
 });
}
export async function confirmBooking(userId:string,eventId:string,holdToken:string,idempotencyKey:string){
 return db.$transaction(async tx=>{
  const old=await tx.booking.findUnique({where:{idempotencyKey}}); if(old)return old;
  const now=new Date(); await expireHolds(tx);
  const seats=await tx.showSeat.findMany({where:{eventId,holdToken,status:SeatStatus.HELD},include:{seat:true,event:true}});
  if(!seats.length||seats.some(s=>s.heldById!==userId||!s.holdExpiresAt||s.holdExpiresAt<=now))throw new Error('HOLD_EXPIRED');
  const reference=`SF-${new Date().getFullYear()}-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
  const total=seats.reduce((sum,s)=>sum+priceFor(s.seat.category,s.event),0);
  const booking=await tx.booking.create({data:{reference,userId,eventId,totalAmount:total,idempotencyKey,qrPayload:reference,items:{create:seats.map(s=>({showSeatId:s.id,price:priceFor(s.seat.category,s.event)}))}}});
  await tx.showSeat.updateMany({where:{id:{in:seats.map(s=>s.id)}},data:{status:SeatStatus.BOOKED,bookedAt:now,heldById:null,holdToken:null,holdExpiresAt:null}});
  return booking;
 });
}
export async function cancelBooking(userId:string,bookingId:string){
 return db.$transaction(async tx=>{
  const booking=await tx.booking.findFirst({where:{id:bookingId,userId,status:BookingStatus.CONFIRMED},include:{items:{include:{showSeat:{include:{seat:true}}}},event:true}}); if(!booking)throw new Error('BOOKING_NOT_FOUND');
  await tx.booking.update({where:{id:bookingId},data:{status:BookingStatus.CANCELLED,cancelledAt:new Date()}});
  for(const item of booking.items){
    await tx.showSeat.update({where:{id:item.showSeatId},data:{status:SeatStatus.AVAILABLE,bookedAt:null}});
    const entry=await tx.waitlistEntry.findFirst({where:{eventId:booking.eventId,category:item.showSeat.seat.category,status:WaitlistStatus.WAITING},orderBy:{joinedAt:'asc'}});
    if(entry){await tx.waitlistOffer.create({data:{entryId:entry.id,userId:entry.userId,eventId:booking.eventId,showSeatId:item.showSeatId,expiresAt:new Date(Date.now()+offerTTL()*1000)}});await tx.waitlistEntry.update({where:{id:entry.id},data:{status:WaitlistStatus.OFFERED}});
      await tx.showSeat.update({where:{id:item.showSeatId},data:{status:SeatStatus.HELD,heldById:entry.userId,holdToken:`OFFER:${entry.id}`,holdExpiresAt:new Date(Date.now()+offerTTL()*1000)}});}
  }
  return booking;
 });
}
