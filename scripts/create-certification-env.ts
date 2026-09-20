import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const target = new URL("../.env.certification", import.meta.url);
const template = await readFile(new URL("../.env.certification.example", import.meta.url), "utf8");
const token = (bytes = 36) => randomBytes(bytes).toString("base64url");
const databasePassword = token(24);
const storageUser = `bke-local-${randomBytes(6).toString("hex")}`;
const storagePassword = token(32);

const replacements = new Map<string, string>([
  ["GENERATE_DATABASE_PASSWORD", databasePassword],
  ["GENERATE_LOCAL_STORAGE_ACCESS_KEY", storageUser],
  ["GENERATE_LOCAL_STORAGE_SECRET", storagePassword],
  ["GENERATE_LOCAL_MINIO_USER", storageUser],
  ["GENERATE_LOCAL_MINIO_PASSWORD", storagePassword],
]);

let output = template;
for (const [placeholder, value] of replacements) output = output.replaceAll(placeholder, value);
for (let index = 0; index < 4; index += 1) output = output.replace("GENERATE_INDEPENDENT_48_CHARACTER_SECRET", token());
output = output
  .replace("PAYMENT_PROVIDER=paymongo", "PAYMENT_PROVIDER=mock")
  .replace("PAYMONGO_SECRET_KEY=sk_test_REPLACE_LOCALLY", "PAYMONGO_SECRET_KEY=")
  .replace("PAYMONGO_WEBHOOK_SECRET=REPLACE_LOCALLY", "PAYMONGO_WEBHOOK_SECRET=")
  .replace("EMAIL_PROVIDER=resend", "EMAIL_PROVIDER=log")
  .replace("RESEND_API_KEY=REPLACE_LOCALLY", "RESEND_API_KEY=")
  .replace("RESEND_SANDBOX_TO=OWNER_CONTROLLED_RECIPIENT", "RESEND_SANDBOX_TO=");

try {
  await writeFile(target, output, { encoding: "utf8", mode: 0o600, flag: "wx" });
  console.info("Created ignored .env.certification with generated local-only secrets.");
} catch (error) {
  if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error(".env.certification already exists; refusing to overwrite it");
  throw error;
}
