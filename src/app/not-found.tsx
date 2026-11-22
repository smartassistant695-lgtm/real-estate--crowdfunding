import { ButtonLink } from "@/components/ui/button";
import { Page } from "@/components/ui/primitives";

export default function NotFound() {
  return (
    <Page narrow className="py-16 md:py-24">
      <h1 className="text-2xl md:text-3xl">We couldn’t find that page.</h1>
      <p className="mt-3 max-w-prose text-ink-soft">The address may be mistyped, or the page may have moved. Every home on the platform is listed on the properties page.</p>
      <div className="mt-8 flex flex-wrap gap-3">
        <ButtonLink href="/properties">See all properties</ButtonLink>
        <ButtonLink href="/" variant="secondary">Go to the home page</ButtonLink>
      </div>
    </Page>
  );
}
