import { sha256 } from "@/lib/security/crypto";

/** Stable commercial identity used for limits and history. Agent binding remains separate. */
export function deviceIdentity(deviceId: string): { deviceId: string; deviceHash: string; machineIdHint: string } {
  const normalized = deviceId.trim();
  if (normalized.length < 16) throw new Error("INVALID_DEVICE_ID");
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
