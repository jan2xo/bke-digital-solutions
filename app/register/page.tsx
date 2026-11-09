import { redirect } from "next/navigation";

/** Legacy /register links return to the one Google entry, not a second registration UI. */
export default function RegisterPage() {
  redirect("/login");
}
