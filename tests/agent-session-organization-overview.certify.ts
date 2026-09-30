import assert from "node:assert/strict";
import { db } from "@/platform/host/db";
import { getAgentOrganizationOverview } from "@/apps/web/accounts/agent-organization-overview";
import {
  issueAgentOrganizationInvitationManagementHandle,
  resolveAgentOrganizationInvitationManagementHandle,
  validAgentOrganizationInvitationManagementHandle,
} from "@/apps/web/accounts/agent-organization-invitation-management";
import {
  issueAgentOrganizationMemberManagementHandle,
  resolveAgentOrganizationMemberManagementHandle,
  validAgentOrganizationMemberManagementHandle,
} from "@/apps/web/accounts/agent-organization-member-management";

const suffix = `${Date.now().toString(36)}-${process.pid}`;

async function makeUser(label: string) {
  return db.user.create({
    data: {
      email: `${label}-${suffix}@bke.test`,
      name: label,
      emailVerified: new Date(),
    },
  });
}

const owner = await makeUser("org-overview-owner");
const billing = await makeUser("org-overview-billing");
const licenseManager = await makeUser("org-overview-license");
const member = await makeUser("org-overview-member");
const outsider = await makeUser("org-overview-outsider");

const organization = await db.customerAccount.create({
  data: {
    type: "ORGANIZATION",
    displayName: "Certification Organization",
    ownerId: owner.id,
    billingEmail: "billing-visible@bke.test",
    taxId: "CERT-TAX-001",
    organization: {
      create: {
        legalName: "Certification Organization Legal",
        registrationNumber: "CERT-REG-001",
      },
    },
    memberships: {
      create: [
        { userId: owner.id, role: "OWNER" },
        { userId: billing.id, role: "BILLING" },
        { userId: licenseManager.id, role: "LICENSE_MANAGER" },
        { userId: member.id, role: "MEMBER" },
      ],
    },
    invitations: {
      create: {
        email: `pending-${suffix}@bke.test`,
        role: "MEMBER",
        tokenHash: `organization-overview-token-${suffix}`,
        status: "PENDING",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    },
  },
});

const memberMembership = await db.membership.findFirstOrThrow({
  where: {
    accountId: organization.id,
    userId: member.id,
  },
  select: {
    userId: true,
    createdAt: true,
  },
});

const pendingInvitation = await db.invitation.findFirstOrThrow({
  where: {
    accountId: organization.id,
    status: "PENDING",
  },
  select: {
    id: true,
  },
});

const personal = await db.customerAccount.create({
  data: {
    type: "INDIVIDUAL",
    displayName: "Certification Personal",
    ownerId: owner.id,
    billingEmail: owner.email,
  },
});

try {
  const ownerOverview = await getAgentOrganizationOverview({
    principalId: owner.id,
    accountId: organization.id,
  });
  assert.equal(ownerOverview.status, "ready");
  if (ownerOverview.status !== "ready") throw new Error("owner overview missing");
  assert.equal(ownerOverview.role, "OWNER");
  assert.deepEqual(ownerOverview.permissions, {
    manageMembers: true,
    leaveOrganization: false,
    viewBilling: true,
    viewLicenses: true,
  });
  assert.equal(ownerOverview.organization.legalName, "Certification Organization Legal");
  assert.equal(ownerOverview.organization.registrationNumber, "CERT-REG-001");
  assert.equal(ownerOverview.billingEmail, "billing-visible@bke.test");
  assert.equal(ownerOverview.taxId, "CERT-TAX-001");
  assert.deepEqual(ownerOverview.counts, {
    licenses: 0,
    subscriptions: 0,
    orders: 0,
  });
  assert.equal(ownerOverview.members.length, 4);
  const ownerMember = ownerOverview.members.find(
    (candidate) => candidate.email === member.email,
  );
  assert.ok(ownerMember);
  assert.equal(
    validAgentOrganizationMemberManagementHandle(
      ownerMember.managementHandle,
    ),
    true,
  );
  assert.equal(
    ownerMember.managementHandle.includes(
      memberMembership.userId,
    ),
    false,
  );
  assert.equal(
    ownerMember.managementHandle,
    issueAgentOrganizationMemberManagementHandle(
      organization.id,
      memberMembership.userId,
      memberMembership.createdAt,
    ),
  );
  assert.equal(
    await resolveAgentOrganizationMemberManagementHandle({
      accountId: organization.id,
      handle: ownerMember.managementHandle,
    }),
    member.id,
  );
  assert.equal(
    await resolveAgentOrganizationMemberManagementHandle({
      accountId: personal.id,
      handle: ownerMember.managementHandle,
    }),
    null,
  );
  assert.equal(ownerOverview.invitations.length, 1);
  const ownerInvitation = ownerOverview.invitations[0]!;
  assert.equal(
    validAgentOrganizationInvitationManagementHandle(
      ownerInvitation.managementHandle,
    ),
    true,
  );
  assert.equal(
    ownerInvitation.managementHandle.includes(
      pendingInvitation.id,
    ),
    false,
  );
  assert.equal(
    ownerInvitation.managementHandle,
    issueAgentOrganizationInvitationManagementHandle(
      organization.id,
      pendingInvitation.id,
    ),
  );
  assert.equal(
    await resolveAgentOrganizationInvitationManagementHandle({
      accountId: organization.id,
      handle: ownerInvitation.managementHandle,
    }),
    pendingInvitation.id,
  );
  assert.equal(
    await resolveAgentOrganizationInvitationManagementHandle({
      accountId: personal.id,
      handle: ownerInvitation.managementHandle,
    }),
    null,
  );
  assert.equal(
    Object.hasOwn(ownerOverview.members[0] ?? {}, "userId"),
    false,
  );
  assert.equal(
    Object.hasOwn(ownerOverview.members[0] ?? {}, "id"),
    false,
  );
  assert.equal(
    Object.hasOwn(ownerOverview.invitations[0] ?? {}, "id"),
    false,
  );

  const billingOverview = await getAgentOrganizationOverview({
    principalId: billing.id,
    accountId: organization.id,
  });
  assert.equal(billingOverview.status, "ready");
  if (billingOverview.status !== "ready") throw new Error("billing overview missing");
  assert.equal(billingOverview.role, "BILLING");
  assert.deepEqual(billingOverview.permissions, {
    manageMembers: false,
    leaveOrganization: true,
    viewBilling: true,
    viewLicenses: false,
  });
  assert.equal(billingOverview.billingEmail, "billing-visible@bke.test");
  assert.equal(billingOverview.taxId, "CERT-TAX-001");
  assert.deepEqual(billingOverview.counts, {
    licenses: null,
    subscriptions: 0,
    orders: 0,
  });
  assert.deepEqual(billingOverview.members, []);
  assert.deepEqual(billingOverview.invitations, []);

  const licenseOverview = await getAgentOrganizationOverview({
    principalId: licenseManager.id,
    accountId: organization.id,
  });
  assert.equal(licenseOverview.status, "ready");
  if (licenseOverview.status !== "ready") throw new Error("license overview missing");
  assert.equal(licenseOverview.role, "LICENSE_MANAGER");
  assert.deepEqual(licenseOverview.permissions, {
    manageMembers: false,
    leaveOrganization: true,
    viewBilling: false,
    viewLicenses: true,
  });
  assert.equal(licenseOverview.billingEmail, null);
  assert.equal(licenseOverview.taxId, null);
  assert.deepEqual(licenseOverview.counts, {
    licenses: 0,
    subscriptions: 0,
    orders: null,
  });
  assert.deepEqual(licenseOverview.members, []);
  assert.deepEqual(licenseOverview.invitations, []);

  const memberOverview = await getAgentOrganizationOverview({
    principalId: member.id,
    accountId: organization.id,
  });
  assert.equal(memberOverview.status, "ready");
  if (memberOverview.status !== "ready") throw new Error("member overview missing");
  assert.equal(memberOverview.role, "MEMBER");
  assert.deepEqual(memberOverview.permissions, {
    manageMembers: false,
    leaveOrganization: true,
    viewBilling: false,
    viewLicenses: false,
  });
  assert.equal(memberOverview.billingEmail, null);
  assert.equal(memberOverview.taxId, null);
  assert.deepEqual(memberOverview.counts, {
    licenses: null,
    subscriptions: null,
    orders: null,
  });
  assert.deepEqual(memberOverview.members, []);
  assert.deepEqual(memberOverview.invitations, []);

  const personalOverview = await getAgentOrganizationOverview({
    principalId: owner.id,
    accountId: personal.id,
  });
  assert.deepEqual(personalOverview, { status: "not_organization" });

  const outsiderOverview = await getAgentOrganizationOverview({
    principalId: outsider.id,
    accountId: organization.id,
  });
  assert.deepEqual(outsiderOverview, { status: "forbidden" });

  console.log("Agent-session organization overview certification: PASS");
} finally {
  await db.customerAccount.deleteMany({
    where: { id: { in: [organization.id, personal.id] } },
  });
  await db.user.deleteMany({
    where: {
      id: {
        in: [
          owner.id,
          billing.id,
          licenseManager.id,
          member.id,
          outsider.id,
        ],
      },
    },
  });
}
