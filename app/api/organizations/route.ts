import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { assertSameOrigin } from "@/lib/security/request";
import { createOrganizationAccount, listSwitchableAccounts } from "@/lib/organizations";
import { assertLegalAcceptanceCurrent } from "@/lib/legal/service";
const createSchema = z.object({ displayName: z.string().trim().min(2).max(120), legalName: z.string().trim().min(2).max(180), billingEmail: z.string().trim().email(), registrationNumber: z.string().trim().max(80).optional(), taxId: z.string().trim().max(80).optional() }).strict();

export async function GET() { try { const user = await requireUser(); const accounts = await listSwitchableAccounts(user.id); return NextResponse.json(accounts.map((account) => ({ id: account.id, type: account.type, displayName: account.displayName, lifecycleState: account.lifecycleState, role: account.ownerId === user.id ? "OWNER" : account.memberships[0]?.role ?? "MEMBER" }))); } catch (error) { return apiError(error); } }

export async function POST(request: Request) { try { assertSameOrigin(request); const user = await requireUser(); if (!user.emailVerified) throw new Error("EMAIL_NOT_VERIFIED"); await assertLegalAcceptanceCurrent(user.id); const input = createSchema.parse(await request.json()); const account = await createOrganizationAccount({ actorId: user.id, ...input }); return NextResponse.json({ id: account.id }, { status: 201 }); } catch (error) { return apiError(error); } }
