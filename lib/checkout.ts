import "server-only";

/**
 * @deprecated Test-only compatibility surface for pre-V2 integration suites.
 * Production routes must use @bke/commerce capabilities through the V2 web runtime.
 */
export { createCheckout } from "@/tests/support/legacy-checkout-fixture";
