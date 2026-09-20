export type TrustedSupplyChainKeyring = Record<string, string>;

export function parseTrustedSupplyChainKeys(raw: string | undefined, fallbackId: string, fallbackKey?: string): TrustedSupplyChainKeyring {
  if (!raw) return fallbackKey ? { [fallbackId]: fallbackKey } : {};
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error("SUPPLY_CHAIN_TRUST_KEYRING_INVALID"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("SUPPLY_CHAIN_TRUST_KEYRING_INVALID");
  const entries = Object.entries(parsed as Record<string, unknown>);
  if (!entries.length || entries.some(([id, value]) => !/^[A-Za-z0-9._-]{1,64}$/.test(id) || typeof value !== "string" || value.length < 32)) throw new Error("SUPPLY_CHAIN_TRUST_KEYRING_INVALID");
  return Object.fromEntries(entries) as TrustedSupplyChainKeyring;
}

export function resolveTrustedSupplyChainKey(raw: string | undefined, activeId: string, fallbackKey: string | undefined, requestedId?: string): { keyId: string; key: string } {
  const keyring = parseTrustedSupplyChainKeys(raw, activeId, fallbackKey);
  const keyId = requestedId ?? activeId;
  const key = keyring[keyId];
  if (!key) throw new Error("SUPPLY_CHAIN_TRUST_KEY_NOT_CONFIGURED");
  return { keyId, key };
}
