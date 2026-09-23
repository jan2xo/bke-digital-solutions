"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

type User = Readonly<{ id: string; email: string; name: string | null }>;
type Assignment = Readonly<{
  assignmentId: string;
  userId: string;
  email: string;
  name: string | null;
  createdAt: string;
}>;

export function LicenseSeatManager({
  licenseId,
  maxSeats,
  assignments,
  users,
}: {
  licenseId: string;
  maxSeats: number;
  assignments: readonly Assignment[];
  users: readonly User[];
}) {
  const router = useRouter();
  const [selectedUserId, setSelectedUserId] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const assignedIds = useMemo(
    () => new Set(assignments.map((assignment) => assignment.userId)),
    [assignments],
  );
  const availableUsers = users.filter((user) => !assignedIds.has(user.id));
  const availableSeats = Math.max(0, maxSeats - assignments.length);

  async function assign() {
    if (!selectedUserId) return;
    setBusy("assign");
    setError("");
    const response = await fetch(`/api/licenses/${licenseId}/assignments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: selectedUserId }),
    });
    const body = await response.json();
    if (!response.ok) {
      setError(({
        LICENSE_SEAT_LIMIT: "All seats are already assigned.",
        TARGET_NOT_ACCOUNT_MEMBER: "That user is not an active verified member of this account.",
        ACCOUNT_ROLE_FORBIDDEN: "Your account role cannot assign software seats.",
        LICENSE_NOT_ACTIVE: "This license is not active.",
      } as Record<string, string>)[body.error] ?? "Unable to assign this seat.");
      setBusy("");
      return;
    }
    setSelectedUserId("");
    setBusy("");
    router.refresh();
  }

  async function remove(userId: string) {
    setBusy(userId);
    setError("");
    const response = await fetch(
      `/api/licenses/${licenseId}/assignments/${encodeURIComponent(userId)}`,
      { method: "DELETE" },
    );
    const body = await response.json();
    if (!response.ok) {
      setError(({
        ACCOUNT_ROLE_FORBIDDEN: "Your account role cannot remove software seats.",
        LICENSE_NOT_ACTIVE: "This license is not active.",
      } as Record<string, string>)[body.error] ?? "Unable to remove this seat.");
      setBusy("");
      return;
    }
    setBusy("");
    router.refresh();
  }

  return <div className="grid gap-6">
    <section className="card p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-black">Seat capacity</h2>
          <p className="mt-1 text-sm text-[#a8b5c4]">
            {assignments.length}/{maxSeats} assigned · {availableSeats} available
          </p>
        </div>
      </div>

      {availableSeats > 0 && availableUsers.length > 0 && <div className="mt-5 flex flex-wrap gap-3">
        <select className="input min-w-64 flex-1" value={selectedUserId} onChange={(event) => setSelectedUserId(event.target.value)}>
          <option value="">Choose account member</option>
          {availableUsers.map((user) => <option value={user.id} key={user.id}>
            {user.name ? `${user.name} · ${user.email}` : user.email}
          </option>)}
        </select>
        <button className="button" disabled={!selectedUserId || Boolean(busy)} onClick={assign}>
          {busy === "assign" ? "Assigning…" : "Assign seat"}
        </button>
      </div>}

      {availableSeats === 0 && <p className="mt-5 text-sm font-semibold text-amber-300">All purchased seats are assigned.</p>}
      {availableUsers.length === 0 && availableSeats > 0 && <p className="mt-5 text-sm text-[#a8b5c4]">Every eligible account member already has a seat.</p>}
    </section>

    <section className="card p-6">
      <h2 className="text-xl font-black">Assigned users</h2>
      <div className="mt-4 grid gap-3">
        {assignments.length === 0
          ? <p className="text-sm text-[#a8b5c4]">No seats assigned yet.</p>
          : assignments.map((assignment) => <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#2d3850] bg-[#151d29] p-4" key={assignment.assignmentId}>
              <div>
                <p className="font-bold">{assignment.name ?? assignment.email}</p>
                {assignment.name && <p className="text-sm text-[#a8b5c4]">{assignment.email}</p>}
              </div>
              <button className="button secondary" disabled={Boolean(busy)} onClick={() => remove(assignment.userId)}>
                {busy === assignment.userId ? "Removing…" : "Remove seat"}
              </button>
            </div>)}
      </div>
    </section>

    {error && <p role="alert" className="text-sm font-bold text-red-500">{error}</p>}
  </div>;
}
