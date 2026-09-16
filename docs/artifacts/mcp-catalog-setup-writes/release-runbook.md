# Release runbook — MCP catalogue setup writes and the V24 recipe read

Branch `feat/recipe-mcp-read` (merge of `origin/main` `5fa0a21e1` included). Every step was rehearsed on a local copy of production before it ran against production. Migrations are applied through the Supabase migration tool (project `ijeekuhbatykdomumfjx`); verification is by object fingerprint, never by ledger version.

## Order

1. Migrations 1–8, in order. Each carries its own `begin;`/`commit;`, guards on the exact production state it expects, and aborts on drift. The V24 migration lands before the code: the app then sets `ACTIVE_MCP_EXPOSURE_REVISION` to V24, and a database that does not accept V24 fails every MCP bearer.
2. Fingerprint verification (section 2).
3. Merge the pull request with a merge commit, let Vercel deploy `main`, confirm READY.
4. Activation seal (section 4) — only after migration 8, which rewrites three compile functions the seal hashes.
5. Release evidence in the bible (chapter 04) and the gap log.

## 1. Migrations

| # | File | md5 of file |
|---|---|---|
| 1 | `20260915224500_agent_catalog_recipe_read_v24.sql` | `079ee3fb54e43729652012e21588ec5f` |
| 2 | `20260916010000_agent_catalog_setup_write_variant.sql` | `7e7f0364c345872bf3a1c47936af169c` |
| 3 | `20260916020000_agent_catalog_setup_write_thresholds.sql` | `314d4cc098fd1cde86aae339bdc9d734` |
| 4 | `20260916030000_agent_catalog_setup_write_pricing.sql` | `34c525451ac1c68f6ffa1dd7b3375e50` |
| 5 | `20260916040000_agent_catalog_setup_write_supplier_cost.sql` | `b72e9c1d70fb1d6dfff7e69c7211fa1e` |
| 6 | `20260916050000_agent_catalog_setup_write_option.sql` | `5d87224a5b0c850f4c80a0ca4f5e6f6b` |
| 7 | `20260916060000_repair_double_encoded_catalog_text.sql` | `e4493f2524650a6f38f1151024991e17` |
| 8 | `20260916070000_agent_catalog_setup_write_money_precision.sql` | `d045ee769de874ffe141c5466c50259c` |

Production preconditions read on 2026-09-16 before applying: `private.agent_p2_catalog_detail_v1` prosrc md5 `bb36d87af76f5e759a58a3bf7183c42e` (28 arguments), `public.catalog_setup_save` `f5c4630d0282d999b5b691c22b63d84a`, `private.mcp_oauth_labels_for_scopes` `bbef08d0e5844eefc18566d6c7c70352`, no active catalogue / financial / site-visit trial binding, `private.agent_catalog_effect_policy` holding exactly one row (`2026-09-08.v1`, the V19 seal, untouched by this release).

## 2. Expected fingerprints after migration 8 (`md5(prosrc)`, from the local rehearsal)

| function | md5 |
|---|---|
| private.agent_catalog_setup_bounded_object | a1ef1182b997bcf666de92bd0e9ccb8d |
| private.agent_catalog_setup_compile_create_option | 6bf2835822fe990670874aeb61b4974e |
| private.agent_catalog_setup_compile_create_variant | 6cd327573d82f71b5aed5658c15e05e0 |
| private.agent_catalog_setup_compile_set_pricing | d637920c83e3bf53d1a421e425ea5755 |
| private.agent_catalog_setup_compile_set_supplier_cost | adfdd78019b3f27f8b4601aa0d4102b2 |
| private.agent_catalog_setup_compile_set_thresholds | 20a0c7e406051f638dd0ba27ca66a546 |
| private.agent_catalog_setup_exact | aeabe475f20bb04dfd664f0d0d831aa1 |
| private.agent_catalog_setup_family_state | bb1586bd33ff5f60ca831b8c8b6f11d2 |
| private.agent_catalog_setup_money | b7588c2495cb5c2dc03d9fcbb4675b77 |
| private.agent_catalog_setup_option_projection | f4cea763564308839b14d70700ac454b |
| private.agent_catalog_setup_pricing_projection | be04f362f89aef524f3b4ede3799826c |
| private.agent_catalog_setup_supplier_cost_projection | 9734dded044596743922079724600b69 |
| private.agent_catalog_setup_threshold_level | 78e299f25fa95bd6e7116e96d7ec515b |
| private.agent_catalog_setup_threshold_projection | 8590f95ca81b266f6e1dec4ecbfcd05f |
| private.agent_catalog_setup_value_labels | af020c5a2f7285d43f2555989283c539 |
| private.agent_catalog_setup_variant_projection | 41e5b7f216fabf9947e12ab07b9f30be |
| private.agent_catalog_setup_whole | c544463f3a29d592a9e76a8278c4e2da |
| private.agent_catalog_setup_write_apply | f5fabc043b7f97e8dec7d614c03c2ac2 |
| private.agent_catalog_setup_write_assert_seal | 86f7b5d3d362e7db6e32e42a7879db6f |
| private.agent_catalog_setup_write_can_read | a8baab99dc27acff8c193c8d716cadcf |
| private.agent_catalog_setup_write_compile | 53eeda91ecdfedd98ee74062aa61fe53 |
| private.agent_catalog_setup_write_effect_revision | a56dcc88d2f1a917d48833066bd6eb32 |
| private.agent_catalog_setup_write_hash | 3c153b7e0f89bb29c71f3978b49a7469 |
| private.agent_catalog_setup_write_kind_capability | b6887e410ac06a3dbb874b3c4f8b1961 |
| private.agent_catalog_setup_write_kind_notice | 4f13d7112eeceecdb6b742fb84afec45 |
| private.agent_catalog_setup_write_kind_operation | ec0a33fa923bbb7e391fe6b09d4a5dd0 |
| private.agent_catalog_setup_write_kind_scopes | f5ffc480b1a53f4e15eb50043a34c3f8 |
| private.agent_catalog_setup_write_payload | 80e79a55e0c77b0e095d1ec7fceb4f08 |
| private.agent_catalog_setup_write_readback | ad8f149143d8a48b8d88253eb2dbb3e1 |
| private.agent_catalog_setup_write_reauthorize | cd622b68dc1547a58057075400c1556c |
| private.agent_p2_catalog_detail_v1 | 34503d7f4aa58965c7635926656c7031 |
| private.agent_p2_catalog_float8_decimal4_v1 | acd1b3122792c12b56b3b5f117d8674f |
| private.assert_agent_catalog_setup_write_authority | 4abc4740783122dcb1b9035dc0077004 |
| private.assert_agent_customer_update_authority | 5003837671c5207c44255affa4570e7d |
| private.catalog_family_default_price_save | 06d241bdb8484870ff8fd1598bf29327 |
| private.catalog_supplier_cost_profile_save | 055e527e7b0534c390c08158cd7d9b09 |
| private.mcp_oauth_labels_for_scopes | e7d08c8c71d59d63393b4c54d859dc96 |
| public.can_read_catalog_setup_write_action | d2d3401968ee0de3cef6118e8b07eb11 |
| public.commit_catalog_setup_write_as_actor | e515d98f1e3d761539e2f259f99a12b9 |
| public.consume_agent_customer_update_prepare_rate_limit_as_system | e35b9c906c35d9085848b51812e3e296 |
| public.consume_catalog_setup_write_prepare_rate_limit_as_system | ea9b3e3d53748f0b2fdc42313516beae |
| public.filter_catalog_setup_write_actions_as_actor | 7d55cf2f245d3c8d67fbfc511db64efa |
| public.prepare_agent_customer_update_for_grant_as_system | fb488923a76437326405ecbc6c4e7031 |
| public.prepare_catalog_setup_write_as_system | 0410f802aaa0d10a9ba30317312c1c1b |
| public.read_agent_catalog_item_as_system | a206b99c270ac8d6682087500451536f |
| public.reject_catalog_setup_write_as_actor | 8bf9b4f4e616f3d87969b5acc2457aff |
| public.resolve_mcp_oauth_access_token_as_system | 63b29258288a11ef1c9ae5b8020fea1c |

Also: `private.agent_catalog_setup_writes` has 0 rows; `private.agent_catalog_effect_policy` still has exactly the one V19 row until activation; `private.catalog_text_repairs_20260916` has 172 rows; no live `catalog_supplier_cost_profiles.unit_cost` is finer than a cent.

## 3. Code

Pull request from `feat/recipe-mcp-read` to `main`, merged with a merge commit so the proof documents' commit references stay valid. After Vercel reports READY for `main`: anonymous `GET /api/mcp/oauth/userinfo` still returns 401 with `Cache-Control: no-store`; an existing V23 grant still resolves under active V24.

## 4. Activation

```sql
insert into private.agent_catalog_effect_policy (revision, effect_sha256)
values ('2026-09-15.catalog-setup-write.v1', private.agent_catalog_setup_write_effect_revision());
```

Before this row exists every catalogue `prepare_*` tool answers `CATALOG_SETUP_WRITE_ACTIVATION_REQUIRED`. Existing connections must re-authorize to obtain V24 and `ops.catalog.prepare`.

## Rollback

Code: revert the merge commit; the database accepts V23 and V24 side by side. Database: delete the seal row to deactivate; the write tables and functions are inert without it. The text repair is reversible row by row from `private.catalog_text_repairs_20260916`.
