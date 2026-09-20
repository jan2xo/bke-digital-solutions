export function integrityEvidencePlan(signaturePresent: boolean, checksumPresent: boolean) {
  return { createSignature: !signaturePresent, createChecksum: !checksumPresent };
}
