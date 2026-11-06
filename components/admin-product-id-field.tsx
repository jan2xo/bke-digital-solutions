"use client";

import { useId } from "react";
import { CATALOG_PRODUCT_ID_MAX_LENGTH } from "@bke/catalog/logic/product-identity-policy";

/**
 * Keep the browser pattern aligned with @bke/catalog's immutable identity grammar.
 * The server remains the authoritative validator.
 */
export const ADMIN_PRODUCT_ID_INPUT_PATTERN = "[a-z][a-z0-9]*(?:-[a-z0-9]+)*";

export function AdminProductIdField({ defaultValue = "" }: { readonly defaultValue?: string }) {
  const inputId = useId();
  const hintId = `${inputId}-hint`;
  return (
    <div className="grid gap-1">
      <label className="label" htmlFor={inputId}>Product ID</label>
      <input
        className="input"
        id={inputId}
        aria-describedby={hintId}
        name="productId"
        type="text"
        defaultValue={defaultValue}
        pattern={ADMIN_PRODUCT_ID_INPUT_PATTERN}
        maxLength={CATALOG_PRODUCT_ID_MAX_LENGTH}
        placeholder="bke-media-organizer"
        title="Start with a lowercase letter; use lowercase letters, numbers, and single hyphens between words (maximum 80 characters)."
        autoCapitalize="none"
        spellCheck={false}
        required
      />
      <span id={hintId} className="text-xs text-slate-600">
        Permanent licensing ID, e.g. bke-media-organizer. Lowercase letters, numbers, and single hyphens only; no spaces or underscores.
      </span>
    </div>
  );
}
