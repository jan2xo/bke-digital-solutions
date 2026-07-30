import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import argon2 from "argon2";

const db=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL!})});
async function main(){const rl=createInterface({input:stdin,output:stdout});const email=(process.env.ADMIN_EMAIL??await rl.question("Admin email: ")).trim().toLowerCase();const name=(process.env.ADMIN_NAME??await rl.question("Admin name: ")).trim();const password=process.env.ADMIN_PASSWORD??await rl.question("Admin password (input may be visible): ");rl.close();if(password.length<12)throw new Error("Admin password must be at least 12 characters");const passwordHash=await argon2.hash(password,{type:argon2.argon2id,memoryCost:19456,timeCost:2,parallelism:1});await db.user.upsert({where:{email},update:{name,role:"ADMIN",emailVerified:new Date(),credential:{upsert:{create:{passwordHash},update:{passwordHash,changedAt:new Date()}}}},create:{email,name,role:"ADMIN",emailVerified:new Date(),credential:{create:{passwordHash}},ownedAccounts:{create:{type:"INDIVIDUAL",displayName:name,billingEmail:email}}}});console.info("Administrator account is ready.")}main().finally(()=>db.$disconnect());
