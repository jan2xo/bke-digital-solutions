import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as ts from "typescript";

const navigationSources = [
  "components/header.tsx",
  "components/footer.tsx",
  "app/landing-experience.tsx",
  "app/products/page.tsx",
] as const;

function allLinkPrefetchValues(path: string) {
  const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const values: boolean[] = [];
  function visit(node: ts.Node): void {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      if (node.tagName.getText(source) === "Link") {
        const attrs = node.attributes.properties.filter(
          (attr): attr is ts.JsxAttribute => ts.isJsxAttribute(attr) &&
            attr.name.getText(source) === "prefetch",
        );
        const initializer = attrs.length === 1 ? attrs[0].initializer : undefined;
        values.push(initializer !== undefined && ts.isJsxExpression(initializer) &&
          initializer.expression?.kind === ts.SyntaxKind.FalseKeyword);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return values;
}

describe("Cloudflare Worker request budget for public navigation", () => {
  it.each(navigationSources)("%s opts every Next Link out of speculative RSC prefetching", (path) => {
    const values = allLinkPrefetchValues(path);
    expect(values.length).toBeGreaterThan(0);
    expect(values.every(Boolean)).toBe(true);
  });

  it("preserves the manifest URL while sourcing its bytes from public static assets", () => {
    expect(existsSync("app/manifest.webmanifest")).toBe(false);
    expect(existsSync("public/manifest.webmanifest")).toBe(true);
    const manifest = JSON.parse(readFileSync("public/manifest.webmanifest", "utf8"));
    expect(manifest).toMatchObject({
      name: "BKE Digital Solutions", short_name: "BKE", start_url: "/", display: "standalone",
      icons: [{ src: "/bke-icon.png", sizes: "1254x1254", type: "image/png" }],
    });
    expect(readFileSync("app/layout.tsx", "utf8")).toContain('manifest: "/manifest.webmanifest"');
    const workerConfig = JSON.parse(readFileSync("wrangler.jsonc", "utf8"));
    expect(workerConfig.assets.directory).toBe(".open-next/assets");
    expect(workerConfig.assets.run_worker_first).not.toBe(true);
    expect(readFileSync("scripts/build-workers.mjs", "utf8"))
      .toContain('await readFile(".open-next/assets/manifest.webmanifest")');
  });
});
