BEGIN;

-- email_attachments contains provider identities, private-bucket keys, hashes,
-- and ingestion diagnostics. Keep the canonical table server-only and expose
-- only the descriptor fields a lead detail is allowed to render.
REVOKE ALL ON public.email_attachments FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS email_attachments_company_scope
  ON public.email_attachments;

DROP POLICY IF EXISTS email_attachments_lead_files_select
  ON public.email_attachments;

CREATE OR REPLACE FUNCTION private.is_safe_https_attachment_url(
  p_url text
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_url_match text[];
  v_authority text;
  v_authority_match text[];
  v_host text;
  v_port text;
  v_labels text[];
  v_label text;
BEGIN
  IF p_url !~* '^https://'
     OR p_url ~ '[[:space:][:cntrl:]]'
     OR position(E'\\' IN p_url) > 0 THEN
    RETURN false;
  END IF;

  v_url_match := regexp_match(p_url, '^https://([^/?#]+)', 'i');
  IF v_url_match IS NULL THEN
    RETURN false;
  END IF;
  v_authority := v_url_match[1];
  IF position('@' IN v_authority) > 0 THEN
    RETURN false;
  END IF;

  IF left(v_authority, 1) = '[' THEN
    v_authority_match := regexp_match(
      v_authority,
      '^\[([0-9A-Fa-f:.]+)\](?::([0-9]{1,5}))?$'
    );
    IF v_authority_match IS NULL THEN
      RETURN false;
    END IF;
    v_host := v_authority_match[1];
    v_port := v_authority_match[2];
    BEGIN
      IF family(v_host::inet) <> 6 THEN
        RETURN false;
      END IF;
    EXCEPTION WHEN invalid_text_representation THEN
      RETURN false;
    END;
  ELSE
    v_authority_match := regexp_match(
      v_authority,
      '^([^:]+)(?::([0-9]{1,5}))?$'
    );
    IF v_authority_match IS NULL THEN
      RETURN false;
    END IF;
    v_host := lower(v_authority_match[1]);
    v_port := v_authority_match[2];

    IF length(v_host) > 253 THEN
      RETURN false;
    END IF;
    v_labels := string_to_array(v_host, '.');
    IF v_host ~ '^[0-9.]+$' THEN
      IF cardinality(v_labels) <> 4 THEN
        RETURN false;
      END IF;
      FOREACH v_label IN ARRAY v_labels LOOP
        IF v_label !~ '^[0-9]{1,3}$'
           OR v_label::integer > 255 THEN
          RETURN false;
        END IF;
      END LOOP;
    ELSE
      FOREACH v_label IN ARRAY v_labels LOOP
        IF length(v_label) < 1
           OR length(v_label) > 63
           OR (
             v_label !~ '^[a-z0-9]$'
             AND v_label !~ '^[a-z0-9][a-z0-9-]*[a-z0-9]$'
           ) THEN
          RETURN false;
        END IF;
      END LOOP;
    END IF;
  END IF;

  IF v_port IS NOT NULL
     AND (v_port::integer < 1 OR v_port::integer > 65535) THEN
    RETURN false;
  END IF;
  RETURN true;
END
$function$;

REVOKE ALL ON FUNCTION private.is_safe_https_attachment_url(text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.get_opportunity_lead_files(
  p_opportunity_id uuid
)
RETURNS TABLE (
  id uuid,
  filename text,
  mime_type text,
  source_url text,
  from_email text,
  ingest_status text,
  occurred_at timestamptz,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
  SELECT
    attachment.id,
    attachment.filename,
    attachment.mime_type,
    CASE
      WHEN attachment.ingest_status = 'external' THEN attachment.source_url
      ELSE NULL
    END AS source_url,
    attachment.from_email,
    attachment.ingest_status,
    attachment.occurred_at,
    attachment.created_at
  FROM public.email_attachments AS attachment
  WHERE attachment.opportunity_id = p_opportunity_id
    AND attachment.attribution_status = 'attributed'
    AND attachment.ingest_status IN ('stored', 'external')
    AND (
      attachment.ingest_status = 'stored'
      OR private.is_safe_https_attachment_url(attachment.source_url)
    )
    AND private.current_user_can_view_opportunity_inbox(
      p_opportunity_id,
      attachment.connection_id
    )
  ORDER BY
    attachment.occurred_at DESC NULLS LAST,
    attachment.created_at DESC,
    attachment.id DESC
$function$;

REVOKE ALL ON FUNCTION private.get_opportunity_lead_files(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.get_opportunity_lead_files(uuid)
  TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_opportunity_lead_files(
  p_opportunity_id uuid
)
RETURNS TABLE (
  id uuid,
  filename text,
  mime_type text,
  source_url text,
  from_email text,
  ingest_status text,
  occurred_at timestamptz,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $function$
  SELECT *
  FROM private.get_opportunity_lead_files(p_opportunity_id)
$function$;

REVOKE ALL ON FUNCTION public.get_opportunity_lead_files(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_opportunity_lead_files(uuid)
  TO anon, authenticated;

COMMENT ON FUNCTION public.get_opportunity_lead_files(uuid) IS
  'Invoker-rights API wrapper for safe attributed lead-file descriptors. Authorization and canonical-table access remain in the private implementation.';

COMMENT ON FUNCTION private.get_opportunity_lead_files(uuid) IS
  'Returns safe attributed lead-file descriptors only when the current OPS actor has both lead and mailbox visibility for the attachment connection.';

COMMENT ON TABLE public.email_attachments IS
  'Canonical mailbox-scoped email files. Server-only: clients read safe attributed lead-file descriptors through get_opportunity_lead_files(uuid).';

COMMIT;
