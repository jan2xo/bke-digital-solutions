import "server-only";
import { Resend } from "resend";
import { env } from "@/lib/env";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { resolveResendConfiguration } from "@/lib/provider-config/service";

type Message={to:string;subject:string;text:string};
export interface EmailProvider{send(message:Message):Promise<void>}
class ResendProvider implements EmailProvider{async send(message:Message){const config=await resolveResendConfiguration();const client=new Resend(config.apiKey);const result=await client.emails.send({from:`${config.senderName} <${config.senderEmail}>`,...message});if(result.error)throw new Error("EMAIL_DELIVERY_FAILED")}}
class DevelopmentProvider implements EmailProvider{async send(message:Message){console.info(`[development email] queued: ${message.subject}`)}}
class RuntimeEmailProvider implements EmailProvider{async send(message:Message){const disabled=process.env.BKE_DISABLE_EXTERNAL_EMAIL==="true"||(env.NODE_ENV==="test"&&!process.env.RESEND_SANDBOX_TO);const useLog=env.EMAIL_PROVIDER!=="resend"&&!process.env.RESEND_SANDBOX_TO;if(disabled||useLog)return new DevelopmentProvider().send(message);return new ResendProvider().send(message)}}
export const emailProvider:EmailProvider=new RuntimeEmailProvider();

export async function sendVerificationEmail(email:string,token:string){const url=new URL("/api/auth/verify",env.APP_URL);url.searchParams.set("token",token);await emailProvider.send({to:email,subject:"Verify your BKE Digital Solutions account",text:`Verify your account using this one-time link: ${url}`})}
export async function sendMagicLink(email:string,token:string){const url=new URL("/api/auth/magic/consume",env.APP_URL);url.searchParams.set("token",token);await emailProvider.send({to:email,subject:"Your BKE Digital Solutions sign-in link",text:`Sign in using this one-time link (expires in 15 minutes): ${url}`})}
export async function sendPasswordReset(email:string,token:string){const url=new URL("/reset-password",env.APP_URL);url.searchParams.set("token",token);await emailProvider.send({to:email,subject:"Reset your BKE Digital Solutions password",text:`Reset your password using this one-time link (expires in 30 minutes): ${url}`})}
export async function sendAdministratorLoginCode(email:string,code:string,reference:string){await emailProvider.send({to:email,subject:`Your BKE administrator verification code [${reference}]`,text:`Your BKE administrator verification code is ${code}. Verification reference: ${reference}. It expires in 10 minutes and can be used only once. Only the newest requested code remains valid. If you did not request this code, do not share it and review your account security.`})}

export async function queueCommerceEmail(tx:Prisma.TransactionClient,input:{type:string;recipient:string;subject:string;payload:Record<string,unknown>;deduplicationKey?:string}){
  const data={...input,payload:input.payload as Prisma.InputJsonValue};
  if(input.deduplicationKey){await tx.emailOutbox.createMany({data:[data],skipDuplicates:true});return}
  await tx.emailOutbox.create({data});
}
export async function queueSecurityEmail(tx:Prisma.TransactionClient,input:{type:string;recipient:string;subject:string;deduplicationKey:string;payload?:Record<string,unknown>}){await tx.emailOutbox.createMany({data:[{...input,payload:(input.payload??{}) as Prisma.InputJsonValue}],skipDuplicates:true})}
function render(type:string,payload:Record<string,unknown>){const order=String(payload.orderNumber??"");const invoice=String(payload.invoiceNumber??"");return type==="PAYMENT_RECEIPT"?`Payment for order ${order} was confirmed.`:type==="INVOICE_ISSUED"?`Commercial invoice ${invoice} is available in your customer portal.`:type==="LICENSE_ISSUED"?`Your license for order ${order} is ready. View the full key in your secure portal.`:type==="PAYMENT_FAILED"?`Payment for order ${order} failed. No license was issued.`:type==="REFUND_CONFIRMED"?`The refund for order ${order} was confirmed and its access was revoked.`:type==="SECURITY_SESSIONS_REVOKED"?"Administrator session access was revoked. If this was not you, reset your password and review the security dashboard.":type==="SECURITY_NEW_SESSION"?"A new administrator session was created. Review the security dashboard if this was not you.":type==="SECURITY_ACCOUNT_CHANGED"?"A high-impact administrator security setting changed. Review the security dashboard if this was not you.":"BKE Digital Solutions account notification."}
export async function dispatchEmailOutbox(limit=20){const rows=await db.emailOutbox.findMany({where:{status:{in:["PENDING","FAILED"]},attempts:{lt:5}},orderBy:{createdAt:"asc"},take:limit});for(const row of rows){try{await emailProvider.send({to:row.recipient,subject:row.subject,text:render(row.type,row.payload as Record<string,unknown>)});await db.emailOutbox.update({where:{id:row.id},data:{status:"SENT",sentAt:new Date(),attempts:{increment:1},lastError:null}})}catch(error){await db.emailOutbox.update({where:{id:row.id},data:{status:"FAILED",attempts:{increment:1},lastError:error instanceof Error?error.message.slice(0,120):"EMAIL_DELIVERY_FAILED"}})}}}
