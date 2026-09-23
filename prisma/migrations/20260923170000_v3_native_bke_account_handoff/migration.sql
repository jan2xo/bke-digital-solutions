ALTER TABLE "AgentDeviceAuthorization"
  ADD COLUMN "authorizationKind" TEXT NOT NULL DEFAULT 'DEVICE_CODE';

ALTER TABLE "AgentDeviceAuthorization"
  ADD CONSTRAINT "AgentDeviceAuthorization_authorizationKind_check"
  CHECK ("authorizationKind" IN ('DEVICE_CODE','NATIVE_HANDOFF'));

CREATE INDEX "AgentDeviceAuthorization_authorizationKind_status_idx"
  ON "AgentDeviceAuthorization"("authorizationKind","status");
