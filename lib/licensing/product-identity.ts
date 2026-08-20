import { sha256 } from "@/lib/security/crypto";

/** Stable commercial identity used for limits and history. Agent binding remains separate. */
export function canonicalIdentity(value: string, code = "INVALID_DEVICE_ID"): string {
  if (typeof value !== "string") throw new Error(code);
  const normalized = value.normalize("NFKC").trim();
  if (normalized.length < 16 || /[\u0000-\u001f\u007f]/.test(normalized)) throw new Error(code);
  return normalized;
}

export function deviceIdentity(deviceId: string): { deviceId: string; deviceHash: string; machineIdHint: string } {
  const normalized = canonicalIdentity(deviceId);
  return { deviceId: normalized, deviceHash: sha256(normalized), machineIdHint: normalized.slice(-8) };
}

export type ProductManifest = {
  schema: "bke.manifest.v1";
  product_id: string;
  product_version: string;
  install_id: string;
  device_id: string;
  operating_system?: string;
  architecture?: string;
};

export function buildProductManifest(input: Omit<ProductManifest, "schema">): ProductManifest {
  if (!input.product_id || !input.product_version || !input.install_id || !input.device_id) throw new Error("INVALID_PRODUCT_IDENTITY");
  return { schema: "bke.manifest.v1", ...input };
}
