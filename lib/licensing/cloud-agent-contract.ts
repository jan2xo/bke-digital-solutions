import { z } from "zod";

/** Digital Solutions-owned wire types. Runtime verification remains Agent-owned. */
export const leasePayloadSchema = z.object({
  lease_id: z.string().min(1), generation: z.number().int().positive(), server_revision: z.number().int().positive(),
  product_id: z.string().min(1), installation_id: z.string().min(1), device_id: z.string().min(1), version: z.string().min(1),
  issuer: z.string().min(1), issued_at: z.string().datetime(), not_before: z.string().datetime(), expires_at: z.string().datetime(),
  key_id: z.string().min(1), algorithm: z.literal("Ed25519"), revoked: z.boolean(), superseded_by: z.string().min(1).nullable(),
}).strict();
export const leaseEnvelopeSchema = z.object({ payload: z.string().min(1), signature: z.string().min(1), key_id: z.string().min(1), algorithm: z.literal("Ed25519") }).strict();
export const cloudAgentActionSchema = z.enum(["ACTIVATION", "REFRESH", "RENEWAL", "TRANSFER", "REPLACEMENT", "REVOCATION_REPLACEMENT", "KEY_ROTATION"]);
export const cloudAgentRequestSchema = z.object({
  licenseKey: z.string().min(1), installationId: z.string().min(32).max(256), deviceId: z.string().min(16).max(256), operationId: z.string().min(8).max(128),
  action: cloudAgentActionSchema.default("ACTIVATION"), label: z.string().trim().max(100).optional(), operatingSystem: z.string().trim().max(80).optional(), architecture: z.string().trim().max(80).optional(), predecessorLeaseId: z.string().min(1).optional(),
}).strict();
export type LeasePayload = z.infer<typeof leasePayloadSchema>;
export type LeaseEnvelope = z.infer<typeof leaseEnvelopeSchema>;
export type CloudAgentRequest = z.infer<typeof cloudAgentRequestSchema>;

export function parseLeaseEnvelope(input: unknown): LeaseEnvelope {
  const envelope = leaseEnvelopeSchema.parse(input);
  leasePayloadSchema.parse(JSON.parse(envelope.payload));
  return envelope;
}
