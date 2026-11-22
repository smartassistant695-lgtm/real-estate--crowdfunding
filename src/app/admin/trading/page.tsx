import { ConfirmAction } from "@/components/ui/confirm-action";
import { ActionForm, Input, Select, Submit } from "@/components/ui/form";
import { Badge, PageHeader, SectionHeading, Table, Td, Th } from "@/components/ui/primitives";
import { prisma } from "@/lib/db";
import { fmtDateTime } from "@/lib/labels";
import { requireAdmin } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import { closeWindowAction, openWindowAction, scheduleWindowAction } from "../actions";

export const metadata = { title: "Trading windows" };
const TONE = { SCHEDULED: "neutral", OPEN: "solid", CLOSED: "neutral" } as const;

export default async function AdminTrading() {
  await requireAdmin();
  const [settings, windows, props] = await Promise.all([
    getSettings(),
    prisma.tradingWindow.findMany({ orderBy: { opensAt: "desc" }, take: 24, include: { property: { select: { name: true } }, _count: { select: { orders: true } } } }),
    prisma.property.findMany({ where: { status: { in: ["TRADING", "FUNDED"] } }, orderBy: { sequence: "asc" } }),
  ]);
  return (
    <>
      <PageHeader title="Trading windows" lede={`A window opens automatically on the 1st of each month for ${settings.tradingWindowDays} days (the scheduled job keeps two months ahead). You can also schedule extra windows or open and close them by hand.`} />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-12 pt-10 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <section aria-labelledby="list">
          <SectionHeading id="list">Windows</SectionHeading>
          <Table caption="Trading windows">
            <thead><tr><Th>Opens (UTC)</Th><Th>Closes (UTC)</Th><Th>Applies to</Th><Th num>Orders</Th><Th>Status</Th><Th num><span className="sr-only">Actions</span></Th></tr></thead>
            <tbody>
              {windows.map((w) => (
                <tr key={w.id} className="hover:bg-paper-deep">
                  <Td className="num py-1">{fmtDateTime(w.opensAt).replace(" UTC", "")}</Td>
                  <Td className="num py-1">{fmtDateTime(w.closesAt).replace(" UTC", "")}</Td>
                  <Td className="py-1">{w.property?.name ?? "All trading properties"}</Td>
                  <Td num className="py-1">{w._count.orders}</Td>
                  <Td className="py-1"><Badge tone={TONE[w.status]}>{w.status.toLowerCase()}</Badge></Td>
                  <Td num className="py-1">
                    {w.status === "SCHEDULED" ? <ConfirmAction action={openWindowAction} fields={{ id: w.id }} trigger="Open now" triggerVariant="quiet" title="Open this window now?" body="Holders are notified and can place orders straight away." confirm="Open window" /> : null}
                    {w.status === "OPEN" ? <ConfirmAction action={closeWindowAction} fields={{ id: w.id }} trigger="Close now" triggerVariant="quiet" danger title={`Close this window and expire its open orders?`} body="Every unmatched order expires. Cash held for buy orders and shares held for sell orders are released, and owners are notified." confirm="Close window" /> : null}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </section>
        <section aria-labelledby="schedule">
          <SectionHeading id="schedule">Schedule a window</SectionHeading>
          <ActionForm action={scheduleWindowAction} className="space-y-4">
            <Select label="Applies to" name="propertyId" defaultValue="">
              <option value="">All trading properties</option>
              {props.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
            <Input label="Opens (UTC)" name="opensAt" type="datetime-local" required />
            <Input label="Closes (UTC)" name="closesAt" type="datetime-local" required />
            <Submit variant="secondary" pendingLabel="Scheduling…">Schedule</Submit>
          </ActionForm>
        </section>
      </div>
    </>
  );
}
