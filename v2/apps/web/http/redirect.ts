export function safeLocalRedirect(value: string | null | undefined, fallback = "/dashboard") {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return fallback;
  if (value.includes(String.fromCharCode(92)) || value.includes(String.fromCharCode(13)) || value.includes(String.fromCharCode(10))) {
    return fallback;
  }
  try {
    const parsed = new URL(value, "http://local.invalid");
    return parsed.origin === "http://local.invalid"
      ? `${parsed.pathname}${parsed.search}${parsed.hash}`
      : fallback;
  } catch {
    return fallback;
  }
}
