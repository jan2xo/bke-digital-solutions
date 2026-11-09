export type PrCertificationPlan = Readonly<{
  schemaVersion: 1;
  pr: number;
  intent: string;
  requiredTargets: readonly string[];
  testFiles: readonly string[];
}>;

export declare function validatePrPlan(
  plan: unknown,
  pr: number,
  fileExists?: (path: string) => boolean,
): PrCertificationPlan;

export declare function readPrPlan(
  pr: number,
  root?: string,
): PrCertificationPlan;

export declare function runPrCertification(
  pr: number,
  sha: string,
  cwd?: string,
): void;
