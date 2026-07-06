-- ─────────────────────────────────────────────────────────────────────────────
-- Automation F — paid-invoice cascade: complete + paid ⇒ project 'closed'.
--
-- Bug af27ea82 (part b). A project that is COMPLETE and fully PAID is a terminal
-- SUCCESS and must land in `closed` — never `archived` (that is reserved for
-- operator pause/cancel). Per the OPS bible §10 Automation F, "Invoice status →
-- Paid ⇒ project.status → Closed" is the ONLY automatic terminal transition for
-- a finished job.
--
-- This cascade was documented but never implemented in code, so complete + paid
-- projects lingered in `completed` — which is exactly why the agent-queue
-- lifecycle scan was (wrongly) proposing to ARCHIVE them. The web fix retargets
-- that scan to a `close_project` action; this trigger is the primary,
-- source-agnostic mechanism that makes the scan a rare fallback.
--
-- Why a DB trigger (not app code): invoice `status`/`balance_due` are maintained
-- by the existing `update_invoice_balance()` trigger on `payments`, and customer
-- payments arrive from FOUR distinct writers — the web "record payment" modal,
-- the Stripe portal webhook, the QuickBooks webhook, and the QuickBooks import.
-- Only a cascade at the same DB layer fires for all of them. An app-layer patch
-- in one handler would silently miss the other three.
--
-- Guarantees:
--   • Only advances a project the operator already marked `completed`. It never
--     touches a project in any other state and never writes `archived`.
--   • "Outstanding" excludes voided and soft-deleted invoices (a void invoice is
--     cancelled, not owed).
--   • Best-effort: any failure is logged and swallowed so the cascade can NEVER
--     break payment recording. The operator-approved close_project action and the
--     nightly scan remain the safety net.
--   • It does NOT auto-reopen a closed project if a payment is later voided —
--     reopening is an operator decision, not an automatic one.
--
-- Idempotent / re-runnable: CREATE OR REPLACE + DROP TRIGGER IF EXISTS.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.close_project_when_fully_paid()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_outstanding numeric(12,2);
BEGIN
  -- Only invoices that belong to a project can close one.
  IF NEW.project_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- What is still owed across the project's live invoices. A voided invoice is
  -- cancelled (its stale balance_due is not owed); a soft-deleted invoice is gone.
  SELECT COALESCE(SUM(balance_due), 0)
    INTO v_outstanding
  FROM public.invoices
  WHERE project_id = NEW.project_id
    AND deleted_at IS NULL
    AND status <> 'void';

  -- Complete AND paid → Closed. Guarded to a project the operator already marked
  -- `completed`; never advances any other state and never sets `archived`.
  IF v_outstanding <= 0 THEN
    UPDATE public.projects
       SET status = 'closed'
     WHERE id = NEW.project_id
       AND status = 'completed'
       AND deleted_at IS NULL;
  END IF;

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    -- The cascade rides on the payment-recording transaction. It must never abort
    -- a payment insert, so any error is logged and swallowed. The operator-approved
    -- `close_project` agent action is the safety net for anything missed here.
    RAISE WARNING 'close_project_when_fully_paid failed for invoice % (project %): %',
      NEW.id, NEW.project_id, SQLERRM;
    RETURN NEW;
END;
$$;

-- SECURITY DEFINER + trigger execution does not require the payer to hold EXECUTE
-- on this function, so lock it down (defense in depth — it is only ever meant to
-- run as a trigger, never called directly).
REVOKE ALL ON FUNCTION public.close_project_when_fully_paid() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.close_project_when_fully_paid() FROM anon, authenticated;

-- Fires as a chained trigger after update_invoice_balance() flips an invoice to
-- 'paid'. `UPDATE OF status` + the transition guard keep it to real paid events.
DROP TRIGGER IF EXISTS trg_close_project_on_full_payment ON public.invoices;
CREATE TRIGGER trg_close_project_on_full_payment
AFTER UPDATE OF status ON public.invoices
FOR EACH ROW
WHEN (NEW.status = 'paid' AND OLD.status IS DISTINCT FROM 'paid')
EXECUTE FUNCTION public.close_project_when_fully_paid();

COMMENT ON FUNCTION public.close_project_when_fully_paid() IS
  'Automation F (bug af27ea82): when an invoice becomes fully paid and its project has no remaining outstanding balance, advance a completed project to closed. Never sets archived. Best-effort — never aborts the payment transaction.';
