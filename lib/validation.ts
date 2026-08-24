import { z } from 'zod';
export const registerSchema=z.object({name:z.string().min(2).max(80),email:z.email(),password:z.string().min(8).max(100),role:z.enum(['CUSTOMER','ORGANISER']).default('CUSTOMER')});
export const loginSchema=z.object({email:z.email(),password:z.string().min(1)});
export const holdSchema=z.object({seatIds:z.array(z.string()).min(1).max(10)});
export const bookingSchema=z.object({eventId:z.string(),holdToken:z.string().min(20)});
export const waitlistSchema=z.object({eventId:z.string(),category:z.enum(['PREMIUM','STANDARD','VIP'])});
