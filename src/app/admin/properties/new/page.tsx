import { PageHeader } from "@/components/ui/primitives";
import { requireAdmin } from "@/lib/session";
import { createPropertyAction } from "../../actions";
import { PropertyForm } from "../property-form";

export const metadata = { title: "Add a property" };

export default async function NewProperty() {
  await requireAdmin();
  return (
    <>
      <PageHeader back={{ href: "/admin/properties", label: "Properties" }} title="Add a property" lede="It starts as Coming soon. Add photos, documents and the pre-purchase appraisal, then open the offering." />
      <div className="pt-8"><PropertyForm action={createPropertyAction} /></div>
    </>
  );
}
