BEGIN;
CREATE FUNCTION prevent_invoice_terms_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW."userId",NEW."planVersionId",NEW.network,NEW.recipient,NEW."assetCode",NEW.issuer,NEW.amount,NEW.memo,NEW.terms,NEW."createdAt",NEW."expiresAt")
 IS DISTINCT FROM ROW(OLD."userId",OLD."planVersionId",OLD.network,OLD.recipient,OLD."assetCode",OLD.issuer,OLD.amount,OLD.memo,OLD.terms,OLD."createdAt",OLD."expiresAt") THEN
  RAISE EXCEPTION 'Issued invoice payment and entitlement terms are immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER invoice_terms_immutable BEFORE UPDATE ON "Invoice" FOR EACH ROW EXECUTE FUNCTION prevent_invoice_terms_mutation();
CREATE FUNCTION prevent_plan_version_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Create a new plan version instead of changing an issued version' USING ERRCODE='23514'; END $$;
CREATE TRIGGER plan_versions_immutable BEFORE UPDATE ON "PlanVersion" FOR EACH ROW EXECUTE FUNCTION prevent_plan_version_mutation();
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_stellar_terms_valid" CHECK (
 network IN ('testnet','mainnet') AND "assetCode"='USDC' AND amount ~ '^[0-9]{1,12}\.[0-9]{7}$' AND amount::numeric>0
 AND octet_length(memo)<=28
 AND ((network='testnet' AND issuer='GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5') OR (network='mainnet' AND issuer='GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN'))
);
INSERT INTO "AdminAudit" (id,"actorId",action,"targetId",reason,"oldValues","newValues",details)
SELECT 'initial-billing-config-audit','migration','billing.initialize',id,'Owner confirmed 5 USDC / 14 days, manual extension, unlimited Pro solves, four GitHub accounts; Basic lifetime one issue; public receiving address supplied','{}',settings,'{"checkoutEnabled":false,"mainnetEnabled":false}'::jsonb FROM "PlanVersion" WHERE id='initial-billing-plan'
ON CONFLICT(id) DO NOTHING;
COMMIT;
