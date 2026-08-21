import { z } from "zod";

/** Digital Solutions-owned wire types. Runtime verification remains Agent-owned. */
export const CLOUD_AGENT_PROTOCOL_VERSION = "bke.licensing.v2" as const;
export const CLOUD_AGENT_PROTOCOL_HEADER = "x-bke-licensing-version" as const;

export class CloudAgentProtocolError extends Error {
  constructor(public readonly code: string, public readonly status = 400, message = code) {
    super(message);
    this.name = "CloudAgentProtocolError";
  }
}

export function requireCloudAgentVersion(request: Request): void {
  const version = request.headers.get(CLOUD_AGENT_PROTOCOL_HEADER) ?? CLOUD_AGENT_PROTOCOL_VERSION;
  if (version !== CLOUD_AGENT_PROTOCOL_VERSION) throw new CloudAgentProtocolError("UNSUPPORTED_PROTOCOL_VERSION", 400);
}

export const leasePayloadSchema = z.object({
  license_id: z.string().min(1), lease_id: z.string().min(1), generation: z.number().int().positive(), server_revision: z.number().int().positive(),
  product_id: z.string().min(1), installation_id: z.string().min(1), device_id: z.string().min(1), version: z.string().min(1),
  issuer: z.string().min(1), issued_at: z.string().datetime(), not_before: z.string().datetime(), expires_at: z.string().datetime(),
  key_id: z.string().min(1), algorithm: z.literal("Ed25519"), revoked: z.boolean(), superseded_by: z.string().min(1).nullable(),
}).strict();
export const leaseEnvelopeSchema = z.object({ payload: z.string().min(1), signature: z.string().min(1), key_id: z.string().min(1), algorithm: z.literal("Ed25519") }).strict();
export const cloudAgentActionSchema = z.enum(["ACTIVATION", "REFRESH", "RENEWAL", "TRANSFER", "REPLACEMENT", "REVOCATION_REPLACEMENT", "KEY_ROTATION"]);
export const cloudAgentRequestSchema = z.object({
  licenseKey: z.string().min(1), installationId: z.string().min(32).max(256), deviceId: z.string().min(16).max(256), operationId: z.string().min(8).max(128),
  productVersion: z.string().min(1).regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/),
  action: cloudAgentActionSchema.default("ACTIVATION"), label: z.string().trim().max(100).optional(), operatingSystem: z.string().trim().max(80).optional(), architecture: z.string().trim().max(80).optional(), predecessorLeaseId: z.string().min(1).optional(),
}).strict();
export const cloudAgentRefreshRequestSchema = cloudAgentRequestSchema.extend({ currentLeaseId: z.string().uuid() }).strict();
export type LeasePayload = z.infer<typeof leasePayloadSchema>;
export type LeaseEnvelope = z.infer<typeof leaseEnvelopeSchema>;
export type CloudAgentRequest = z.infer<typeof cloudAgentRequestSchema>;

export function parseLeaseEnvelope(input: unknown): LeaseEnvelope {
  const envelope = leaseEnvelopeSchema.parse(input);
  leasePayloadSchema.parse(JSON.parse(envelope.payload));
  return envelope;
}

export function parseCloudAgentRequest(input: unknown): CloudAgentRequest {
  try { return cloudAgentRequestSchema.parse(input); }
  catch { throw new CloudAgentProtocolError("INVALID_REQUEST", 422); }
}

export function validateLifecycleRequest(input: CloudAgentRequest): void {
  if ((input.action === "TRANSFER" || input.action === "REVOCATION_REPLACEMENT") && !input.predecessorLeaseId) {
    throw new CloudAgentProtocolError("PREDECESSOR_LEASE_REQUIRED", 422);
  }
}
