\set ON_ERROR_STOP on
select maverick_test.check(maverick_test.data_snapshot()=(select data from maverick_test.before_migration),'every business, grant and revision row unchanged');
select maverick_test.check(maverick_test.function_security()=(select security from maverick_test.before_migration),'function identity owner ACL security settings unchanged');
select maverick_test.check(not has_function_privilege('anon','private.agent_task_read_instant(timestamptz,boolean,text,boolean)','execute') and not has_function_privilege('authenticated','private.agent_task_read_instant(timestamptz,boolean,text,boolean)','execute') and not has_function_privilege('service_role','private.agent_task_read_instant(timestamptz,boolean,text,boolean)','execute'),'task helper has no application execute grant');
