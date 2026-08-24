import { PrismaClient, Role, EventType, SeatCategory } from '@prisma/client';
import bcrypt from 'bcryptjs';
const db = new PrismaClient();
async function main(){
 const hash=async(p:string)=>bcrypt.hash(p,12);
 const admin=await db.user.upsert({where:{email:'admin@seatforge.dev'},update:{},create:{name:'SeatForge Admin',email:'admin@seatforge.dev',passwordHash:await hash('Admin@12345'),role:Role.ADMIN}});
 const organiser=await db.user.upsert({where:{email:'organiser@seatforge.dev'},update:{},create:{name:'Demo Organiser',email:'organiser@seatforge.dev',passwordHash:await hash('Organiser@12345'),role:Role.ORGANISER}});
 await db.user.upsert({where:{email:'customer@seatforge.dev'},update:{},create:{name:'Demo Customer',email:'customer@seatforge.dev',passwordHash:await hash('Customer@12345'),role:Role.CUSTOMER}});
 const existing=await db.venue.findFirst({where:{name:'Aurora Screen Hall'}});
 if(existing) return;
 const venue=await db.venue.create({data:{name:'Aurora Screen Hall',city:'Chennai',rows:8,seatsPerRow:10}});
 const rows='ABCDEFGH'.split('');
 for(const row of rows){for(let n=1;n<=10;n++){const category=row<'C'?SeatCategory.PREMIUM:row>'F'?SeatCategory.VIP:SeatCategory.STANDARD; await db.seat.create({data:{venueId:venue.id,rowLabel:row,seatNumber:n,category}})}}
 const event=await db.event.create({data:{title:'Neon Nights: The Live Experience',description:'A showcase event for SeatForge seat orchestration.',type:EventType.CONCERT,venueId:venue.id,startsAt:new Date(Date.now()+7*86400000),premiumPrice:1200,standardPrice:800,vipPrice:1800}});
 const seats=await db.seat.findMany({where:{venueId:venue.id}});
 await db.showSeat.createMany({data:seats.map(s=>({eventId:event.id,seatId:s.id}))});
 console.log({admin:admin.email,organiser:organiser.email,event:event.title});
}
main().finally(()=>db.$disconnect());
