import assert from "node:assert/strict";
import { db } from "@/platform/host/db";
import {
  createPrivacyRequest,
  listPrivacyRequestsForAgentSession,
} from "@/apps/web/privacy/requests";

const suffix = `${Date.now().toString(36)}-${process.pid}`;
const ownerEmail = `privacy-agent-owner-${suffix}@bke.test`;
const outsiderEmail = `privacy-agent-outsider-${suffix}@bke.test`;
const request = new Request(
  "https://privacy-cert.bke.test/api/agent-sessions/privacy/requests",
  {
    method: "POST",
    headers: {
      "user-agent": "bke-agent-privacy-cert",
      "x-forwarded-for": "203.0.113.77",
    },
  },
);

const owner = await db.user.create({
  data: {
    email: ownerEmail,
    emailVerified: new Date(),
    ownedAccounts: {
      create: {
        type: "INDIVIDUAL",
        displayName: "Privacy Selected Account",
        billingEmail: ownerEmail,
      },
    },
  },
  include: { ownedAccounts: true },
});
const selectedAccountId = owner.ownedAccounts[0]!.id;
const otherAccount = await db.customerAccount.create({
  data: {
    ownerId: owner.id,
    type: "ORGANIZATION",
    displayName: "Privacy Other Account",
    billingEmail: ownerEmail,
  },
});
const outsider = await db.user.create({
  data: {
    email: outsiderEmail,
    emailVerified: new Date(),
    ownedAccounts: {
      create: {
        type: "INDIVIDUAL",
        displayName: "Privacy Outsider",
        billingEmail: outsiderEmail,
      },
    },
  },
  include: { ownedAccounts: true },
});
const outsiderAccountId = outsider.ownedAccounts[0]!.id;

const selected = await createPrivacyRequest({
  userId: owner.id,
  accountId: selectedAccountId,
  requestType: "ACCESS",
  summary: "Please provide the personal data held for this selected account.",
  request,
});
const userLevel = await createPrivacyRequest({
  userId: owner.id,
  accountId: null,
  requestType: "CORRECTION",
  summary: "Please review the personal identity data associated with my BKE user.",
  request,
});
const other = await createPrivacyRequest({
  userId: owner.id,
  accountId: otherAccount.id,
  requestType: "EXPORT",
  summary: "Please export the data associated with my other organization account.",
  request,
});
const outsiderRequest = await createPrivacyRequest({
  userId: outsider.id,
  accountId: outsiderAccountId,
  requestType: "DELETION",
  summary: "Please review deletion options for this unrelated certification account.",
  request,
});

const visible = await listPrivacyRequestsForAgentSession({
  userId: owner.id,
  accountId: selectedAccountId,
  limit: 50,
});
const visibleIds = new Set(visible.map((item) => item.id));

assert.equal(visibleIds.has(selected.id), true);
assert.equal(visibleIds.has(userLevel.id), true);
assert.equal(visibleIds.has(other.id), false);
assert.equal(visibleIds.has(outsiderRequest.id), false);
assert.equal(visible.every((item) => item.status === "OPEN"), true);

const persisted = await db.privacyRequest.findUniqueOrThrow({
  where: { id: selected.id },
});
assert.equal(persisted.userId, owner.id);
assert.equal(persisted.customerAccountId, selectedAccountId);
assert.equal(persisted.requestType, "ACCESS");
assert.equal(persisted.status, "OPEN");

const event = await db.privacyRequestEvent.findFirstOrThrow({
  where: { privacyRequestId: selected.id },
});
assert.equal(event.eventType, "CREATED");
assert.equal(event.toStatus, "OPEN");

console.log("Agent-session privacy request certification: PASS");

// PrivacyRequestEvent is intentionally immutable. This certification runs only
// against disposable CI databases, so its uniquely named audit rows remain
// until the database container is destroyed instead of bypassing immutability.
