import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-auth px-4 pb-8 pt-14 md:pt-24">{children}</div>;
}
