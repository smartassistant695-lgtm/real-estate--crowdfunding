import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";

/** Where a signed-in user lands: admin panel, the rest of onboarding, or their portfolio. */
export default async function StartPage() {
  const user = await requireUser();
  if (user.role === "ADMIN") redirect("/admin");
  redirect(user.onboardingCompletedAt ? "/portfolio" : "/onboarding");
}
