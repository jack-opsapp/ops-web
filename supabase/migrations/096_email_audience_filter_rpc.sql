-- 096_email_audience_filter_rpc.sql
-- Audience filter resolver. Walks a JSONB tree of nested AND/OR groups
-- with leaf clauses {field, op, value}. SECURITY DEFINER + field allowlist
-- prevents SQL injection.
--
-- Filter grammar:
--   { and: [<node>...] }
--   { or:  [<node>...] }
--   { group: <node> }                 -- explicit grouping
--   { field: text, op: text, value: any }   -- leaf
--
-- Allowlisted fields: email, role, user_type, is_company_admin, is_active,
--   removed_from_email_list, company_id, created_at,
--   plan (= companies.subscription_plan),
--   subscription_status (= companies.subscription_status),
--   trial_end_date (= companies.trial_end_date).
--
-- Allowlisted ops: eq, neq, in, not_in, lt, gt, lte, gte,
--   gte_days (relative to now()), lte_days, is_null, is_not_null, like (ILIKE).

CREATE OR REPLACE FUNCTION public.email_audience_clause_to_sql(
  p_clause jsonb,
  p_alias_users text DEFAULT 'u',
  p_alias_companies text DEFAULT 'c'
) RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_field text := p_clause->>'field';
  v_op    text := p_clause->>'op';
  v_value jsonb := p_clause->'value';
  v_col   text;
BEGIN
  -- Field allowlist → SQL column
  CASE v_field
    WHEN 'email' THEN v_col := p_alias_users || '.email';
    WHEN 'role' THEN v_col := p_alias_users || '.role';
    WHEN 'user_type' THEN v_col := p_alias_users || '.user_type';
    WHEN 'is_company_admin' THEN v_col := p_alias_users || '.is_company_admin';
    WHEN 'is_active' THEN v_col := p_alias_users || '.is_active';
    WHEN 'removed_from_email_list' THEN v_col := p_alias_users || '.removed_from_email_list';
    WHEN 'company_id' THEN v_col := p_alias_users || '.company_id';
    WHEN 'created_at' THEN v_col := p_alias_users || '.created_at';
    WHEN 'plan' THEN v_col := p_alias_companies || '.subscription_plan';
    WHEN 'subscription_status' THEN v_col := p_alias_companies || '.subscription_status';
    WHEN 'trial_end_date' THEN v_col := p_alias_companies || '.trial_end_date';
    ELSE RAISE EXCEPTION 'audience_clause: field % not in allowlist', v_field;
  END CASE;

  CASE v_op
    WHEN 'eq' THEN
      IF v_value IS NULL OR v_value = 'null'::jsonb THEN
        RETURN v_col || ' IS NULL';
      END IF;
      RETURN v_col || ' = ' || quote_nullable(v_value #>> '{}');
    WHEN 'neq' THEN
      RETURN v_col || ' IS DISTINCT FROM ' || quote_nullable(v_value #>> '{}');
    WHEN 'in' THEN
      IF jsonb_typeof(v_value) <> 'array' THEN RAISE EXCEPTION 'in: value must be array'; END IF;
      RETURN v_col || ' = ANY(' || quote_literal(ARRAY(SELECT jsonb_array_elements_text(v_value)))::text || '::text[])';
    WHEN 'not_in' THEN
      IF jsonb_typeof(v_value) <> 'array' THEN RAISE EXCEPTION 'not_in: value must be array'; END IF;
      RETURN '(' || v_col || ' IS NULL OR NOT (' || v_col || ' = ANY(' || quote_literal(ARRAY(SELECT jsonb_array_elements_text(v_value)))::text || '::text[])))';
    WHEN 'lt' THEN
      RETURN v_col || ' < ' || quote_nullable(v_value #>> '{}');
    WHEN 'gt' THEN
      RETURN v_col || ' > ' || quote_nullable(v_value #>> '{}');
    WHEN 'lte' THEN
      RETURN v_col || ' <= ' || quote_nullable(v_value #>> '{}');
    WHEN 'gte' THEN
      RETURN v_col || ' >= ' || quote_nullable(v_value #>> '{}');
    WHEN 'gte_days' THEN
      RETURN v_col || ' >= now() - (' || quote_nullable(v_value #>> '{}') || ' || '' days'')::interval';
    WHEN 'lte_days' THEN
      RETURN v_col || ' <= now() - (' || quote_nullable(v_value #>> '{}') || ' || '' days'')::interval';
    WHEN 'is_null' THEN
      RETURN v_col || ' IS NULL';
    WHEN 'is_not_null' THEN
      RETURN v_col || ' IS NOT NULL';
    WHEN 'like' THEN
      RETURN v_col || ' ILIKE ' || quote_nullable('%' || (v_value #>> '{}') || '%');
    ELSE RAISE EXCEPTION 'audience_clause: op % not in allowlist', v_op;
  END CASE;
END $$;

CREATE OR REPLACE FUNCTION public.email_audience_node_to_sql(
  p_node jsonb,
  p_alias_users text DEFAULT 'u',
  p_alias_companies text DEFAULT 'c'
) RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_children jsonb;
  v_parts text[] := ARRAY[]::text[];
  v_child jsonb;
  v_combinator text;
BEGIN
  -- Group wrapper: { group: <node> }
  IF p_node ? 'group' THEN
    RETURN '(' || public.email_audience_node_to_sql(p_node->'group', p_alias_users, p_alias_companies) || ')';
  END IF;

  -- Leaf: { field, op, value }
  IF p_node ? 'field' AND p_node ? 'op' THEN
    RETURN public.email_audience_clause_to_sql(p_node, p_alias_users, p_alias_companies);
  END IF;

  -- AND / OR
  IF p_node ? 'and' THEN
    v_combinator := ' AND ';
    v_children := p_node->'and';
  ELSIF p_node ? 'or' THEN
    v_combinator := ' OR ';
    v_children := p_node->'or';
  ELSE
    -- Empty filter = match all
    RETURN 'true';
  END IF;

  IF jsonb_typeof(v_children) <> 'array' THEN
    RAISE EXCEPTION 'audience_node: combinator value must be array';
  END IF;

  FOR v_child IN SELECT jsonb_array_elements(v_children) LOOP
    v_parts := array_append(v_parts, public.email_audience_node_to_sql(v_child, p_alias_users, p_alias_companies));
  END LOOP;

  IF array_length(v_parts, 1) IS NULL THEN
    RETURN 'true';
  END IF;

  RETURN '(' || array_to_string(v_parts, v_combinator) || ')';
END $$;

CREATE OR REPLACE FUNCTION public.email_audience_filter(
  p_filter jsonb
) RETURNS TABLE(user_id uuid, email text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_where text;
  v_sql text;
BEGIN
  v_where := public.email_audience_node_to_sql(p_filter, 'u', 'c');
  v_sql := 'SELECT u.id, u.email '
        || 'FROM public.users u '
        || 'LEFT JOIN public.companies c ON c.id = u.company_id '
        || 'WHERE u.email IS NOT NULL '
        || '  AND u.is_active = true '
        || '  AND (u.removed_from_email_list IS NULL OR u.removed_from_email_list = false) '
        || '  AND ' || v_where;
  RETURN QUERY EXECUTE v_sql;
END $$;

CREATE OR REPLACE FUNCTION public.email_audience_count(
  p_filter jsonb
) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_where text;
  v_sql text;
  v_count int;
BEGIN
  v_where := public.email_audience_node_to_sql(p_filter, 'u', 'c');
  v_sql := 'SELECT count(*)::int '
        || 'FROM public.users u '
        || 'LEFT JOIN public.companies c ON c.id = u.company_id '
        || 'WHERE u.email IS NOT NULL '
        || '  AND u.is_active = true '
        || '  AND (u.removed_from_email_list IS NULL OR u.removed_from_email_list = false) '
        || '  AND ' || v_where;
  EXECUTE v_sql INTO v_count;
  RETURN v_count;
END $$;

REVOKE ALL ON FUNCTION public.email_audience_filter(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.email_audience_count(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.email_audience_filter(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.email_audience_count(jsonb) TO service_role;

COMMENT ON FUNCTION public.email_audience_filter IS
  'Resolves a JSONB filter to (user_id, email) rows. SECURITY DEFINER + field/op allowlist prevents SQL injection. Service-role only.';
