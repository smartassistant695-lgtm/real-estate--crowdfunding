-- The ledger and the audit log are append-only. Reject UPDATE and DELETE at the database level
-- so application bugs (or a curious admin with SQL access) cannot rewrite financial history.
CREATE OR REPLACE FUNCTION reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ledger_entry_append_only BEFORE UPDATE OR DELETE ON "LedgerEntry"
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

-- Balances can never go negative, whatever the application does.
ALTER TABLE "Wallet" ADD CONSTRAINT wallet_available_nonneg CHECK ("availableCents" >= 0);
ALTER TABLE "Wallet" ADD CONSTRAINT wallet_held_nonneg CHECK ("heldCents" >= 0);
ALTER TABLE "Holding" ADD CONSTRAINT holding_units_nonneg CHECK ("shareUnits" >= 0);
ALTER TABLE "Holding" ADD CONSTRAINT holding_reserved_range CHECK ("reservedUnits" >= 0 AND "reservedUnits" <= "shareUnits");
ALTER TABLE "HoldingLot" ADD CONSTRAINT lot_remaining_range CHECK ("remainingUnits" >= 0 AND "remainingUnits" <= "originalUnits");
ALTER TABLE "Property" ADD CONSTRAINT property_sold_range CHECK ("soldUnits" >= 0 AND "soldUnits" <= "totalUnits" AND "retiredUnits" >= 0 AND "retiredUnits" <= "soldUnits");
ALTER TABLE "LiquidityReserve" ADD CONSTRAINT reserve_balance_nonneg CHECK ("balanceCents" >= 0);
ALTER TABLE "Order" ADD CONSTRAINT order_fill_range CHECK ("filledUnits" >= 0 AND "filledUnits" <= "shareUnits" AND "heldCents" >= 0);
