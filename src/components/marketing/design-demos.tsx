"use client";

import { Button } from "@/components/ui/button";
import { ActionForm, Input, Submit, type FormAction } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";

export function ToastDemo() {
  const toast = useToast();
  return (
    <Button variant="secondary" onClick={() => toast("Order placed.")}>
      Show a toast
    </Button>
  );
}

export function DemoActionForm({ action }: { action: FormAction }) {
  return (
    <ActionForm action={action} className="max-w-form space-y-5">
      <Input label="Amount" name="amount" prefix="$" inputMode="decimal" defaultValue="12" hint="At least $26. Submit as is to see the error state." />
      <Submit pendingLabel="Checking…" className="w-full sm:w-auto">Check amount</Submit>
    </ActionForm>
  );
}
