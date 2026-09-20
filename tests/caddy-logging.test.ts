import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Caddy access-log redaction", () => {
  for (const file of ["Caddyfile", "Caddyfile.certification"]) {
    it(`${file} removes PayMongo signatures from access logs`, () => {
      const configuration = readFileSync(file, "utf8");
      expect(configuration).toContain("request>headers>Paymongo-Signature delete");
      expect(configuration).not.toContain("log_credentials");
    });
  }
});
