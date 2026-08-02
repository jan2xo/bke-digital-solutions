export type ProviderName = "PAYMONGO" | "RESEND";
export type ProviderContext = "TEST" | "LIVE";
export type ProviderCredentialKind = "SECRET_KEY" | "WEBHOOK_SECRET" | "API_KEY";

export type ResolvedPayMongoConfiguration = {
  source: "environment" | "database";
  secretKey: string;
  webhookSecret: string;
  livemode: boolean;
};

export type ResolvedResendConfiguration = {
  source: "environment" | "database";
  apiKey: string;
  senderName: string;
  senderEmail: string;
  supportEmail: string;
};
