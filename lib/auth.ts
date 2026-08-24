import { cookies } from 'next/headers';
import { jwtVerify, SignJWT } from 'jose';
import { db } from './db';
import type { Role } from '@prisma/client';
const secret=new TextEncoder().encode(process.env.JWT_SECRET||'dev-only-change-me');
export type Session={id:string;role:Role;email:string;name:string};
export async function signSession(user:Session){
 const token=await new SignJWT(user).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('7d').sign(secret);
 (await cookies()).set('seatforge_session',token,{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',path:'/',maxAge:60*60*24*7});
}
export async function getSession():Promise<Session|null>{
 const token=(await cookies()).get('seatforge_session')?.value; if(!token)return null;
 try{return (await jwtVerify(token,secret)).payload as unknown as Session}catch{return null}
}
export async function requireRole(roles:Role[]){const s=await getSession(); if(!s||!roles.includes(s.role)) throw new Error('UNAUTHORIZED'); return s;}
export async function loadUser(){const s=await getSession(); return s?db.user.findUnique({where:{id:s.id}}):null;}
