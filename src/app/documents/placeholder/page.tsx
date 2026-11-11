import type { Metadata } from "next";
import { Note, Page } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Document placeholder" };

export default async function PlaceholderDocument({ searchParams }: { searchParams: Promise<{ title?: string; key?: string }> }) {
  const sp = await searchParams;
  const title = (sp.title ?? sp.key ?? "Document").slice(0, 160);
  return (
    <Page narrow className="py-16">
      <p className="label mb-3">Document</p>
      <h1 className="text-2xl">{title}</h1>
      <Note tone="notice" className="mt-8" title="Placeholder">
        In this demo, document storage is a mock adapter and no file exists behind this link. In a live product this would open the signed PDF from secure storage.
      </Note>
    </Page>
  );
}
