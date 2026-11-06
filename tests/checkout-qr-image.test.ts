import { describe, expect, it } from "vitest";
import { parseCheckoutQrImage } from "../components/checkout-qr-image";

const onePixelPngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j8a8AAAAASUVORK5CYII=";

describe("checkout QR image parsing", () => {
  it("accepts HTTPS image URLs and bounded base64 PNG data URIs", () => {
    expect(parseCheckoutQrImage("https://images.paymongo.com/qr/example.png"))
      .toBe("https://images.paymongo.com/qr/example.png");
    expect(parseCheckoutQrImage("data:image/png;base64," + onePixelPngBase64))
      .toBe("data:image/png;base64," + onePixelPngBase64);
  });

  it("rejects credentials in HTTPS URLs and non-HTTPS protocols", () => {
    expect(parseCheckoutQrImage("https://user:pass@example.test/qr.png")).toBeUndefined();
    expect(parseCheckoutQrImage("http://images.paymongo.com/qr.png")).toBeUndefined();
    expect(parseCheckoutQrImage("javascript:alert(1)")).toBeUndefined();
  });

  it("rejects non-PNG data MIME types, malformed base64, and invalid PNG signatures", () => {
    expect(parseCheckoutQrImage("data:image/svg+xml;base64," + onePixelPngBase64)).toBeUndefined();
    expect(parseCheckoutQrImage("data:image/png;base64,%%%=" )).toBeUndefined();
    expect(parseCheckoutQrImage("data:image/png;base64,QUJDRA==")).toBeUndefined();
  });

  it("rejects data URIs over the encoded size limit", () => {
    const oversized = "data:image/png;base64,iVBORw0KGgo" + "A".repeat(512 * 1024);
    expect(parseCheckoutQrImage(oversized)).toBeUndefined();
  });
});
