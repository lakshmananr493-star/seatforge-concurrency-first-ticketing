import { Resend } from 'resend';
import QRCode from 'qrcode';
export async function sendTicketEmail(to:string,name:string,reference:string,eventTitle:string){
 if(!process.env.RESEND_API_KEY){console.info(`[SeatForge] DEV email skipped for ${to}; ticket=${reference}`);return}
 const qr=await QRCode.toDataURL(reference,{width:320,margin:2});
 const resend=new Resend(process.env.RESEND_API_KEY);
 await resend.emails.send({from:process.env.EMAIL_FROM||'SeatForge <tickets@example.com>',to,subject:`Your SeatForge ticket — ${reference}`,html:`<div style="font-family:Arial,sans-serif"><h2>You're booked, ${name}!</h2><p>${eventTitle}</p><p><strong>${reference}</strong></p><img src="${qr}" alt="Ticket QR"/><p>Show this QR at entry.</p></div>`});
}

export async function sendWaitlistOfferEmail(to:string,name:string,eventTitle:string,expiresAt:Date){
 if(!process.env.RESEND_API_KEY){console.info(`[SeatForge] DEV waitlist email skipped for ${to}; offer expires=${expiresAt.toISOString()}`);return}
 const resend=new Resend(process.env.RESEND_API_KEY);
 await resend.emails.send({from:process.env.EMAIL_FROM||'SeatForge <tickets@example.com>',to,subject:`A seat opened up — ${eventTitle}`,html:`<div style="font-family:Arial,sans-serif"><h2>Good news, ${name}!</h2><p>A seat from your waitlist is available for <strong>${eventTitle}</strong>.</p><p>Your offer expires at ${expiresAt.toLocaleString()}.</p><p>Open SeatForge and complete checkout before the offer expires.</p></div>`});
}
