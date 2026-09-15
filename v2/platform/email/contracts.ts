export type EmailMessage = Readonly<{
  to: string;
  subject: string;
  text: string;
  idempotencyKey?: string;
}>;

export interface EmailProvider {
  send(message: EmailMessage): Promise<void>;
}

export type EmailOutboxStatus =
  | "PENDING"
  | "PROCESSING"
  | "FAILED"
  | "PERMANENTLY_FAILED"
  | "SENT";

export type EmailOutboxRecord = Readonly<{
  id: string;
  status: EmailOutboxStatus;
  attempts: number;
  message: EmailMessage;
}>;

export interface EmailOutboxStore {
  recoverExpiredClaims(now: Date): Promise<number>;
  listDispatchable(input: Readonly<{ limit: number; maxAttempts: number }>): Promise<readonly EmailOutboxRecord[]>;
  claim(input: Readonly<{
    id: string;
    expectedStatus: EmailOutboxStatus;
    expectedAttempts: number;
    workerId: string;
    claimedAt: Date;
    claimExpiresAt: Date;
  }>): Promise<boolean>;
  markSent(input: Readonly<{
    id: string;
    workerId: string;
    sentAt: Date;
    attempts: number;
  }>): Promise<boolean>;
  markFailed(input: Readonly<{
    id: string;
    workerId: string;
    status: "FAILED" | "PERMANENTLY_FAILED";
    attempts: number;
    failureCode: string;
  }>): Promise<boolean>;
}
