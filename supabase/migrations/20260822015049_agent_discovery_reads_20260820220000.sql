-- Phase 1 MCP discovery reads and capability-manifest v7 compatibility.
--
-- Every public reader remains a fixed service-role boundary. During the
-- zero-downtime manifest cutover, existing readers accept only exact v6 or v7:
-- v6 callers receive the frozen v6 core result unchanged, while v7 callers
-- receive that same literal-v6 result recursively re-proved under v7. New
-- discovery readers remain v7-only. Discovery searches capture actor,
-- permission, company, source revision, visible rows, and database time in one
-- statement and return bounded atomic claims rather than prompt-ready copy.
-- Remove v6 acceptance only in a later migration after every v6 application
-- instance, background job, prepared call, and signed cursor is drained. The
-- private v6 cores must remain while any v7 wrapper still delegates to them.

begin;

create extension if not exists pg_trgm with schema extensions;

-- Supabase projects may already have pg_trgm installed in public, while new
-- projects install it in extensions. Do not relocate the shared extension:
-- resolve its actual operator-class schema, verify the GIN class belongs to
-- that extension namespace, and expose only that schema for the index DDL in
-- this transaction.
do $pg_trgm_schema$
declare
  v_pg_trgm_schema text;
begin
  select namespace.nspname
  into v_pg_trgm_schema
  from pg_catalog.pg_extension extension
  join pg_catalog.pg_namespace namespace
    on namespace.oid = extension.extnamespace
  join pg_catalog.pg_opclass operator_class
    on operator_class.opcnamespace = namespace.oid
   and operator_class.opcname = 'gin_trgm_ops'
  join pg_catalog.pg_am access_method
    on access_method.oid = operator_class.opcmethod
   and access_method.amname = 'gin'
  where extension.extname = 'pg_trgm';

  if v_pg_trgm_schema is null then
    raise exception 'agent_discovery_reads_prerequisite_missing: %',
      'pg_trgm gin_trgm_ops'
      using errcode = '55000';
  end if;

  perform pg_catalog.set_config(
    'search_path',
    pg_catalog.format('pg_catalog,%I,pg_temp', v_pg_trgm_schema),
    true
  );
end;
$pg_trgm_schema$;

do $prerequisites$
declare
  v_signature text;
  v_relation text;
begin
  if not exists (
    select 1
    from pg_catalog.pg_collation
    where collname = 'und-x-icu'
      and collprovider = 'i'
      and collisdeterministic
  ) then
    raise exception 'agent_discovery_reads_prerequisite_missing: %',
      'pg_catalog collation und-x-icu'
      using errcode = '55000';
  end if;

  foreach v_signature in array array[
    'private.resolve_agent_actor_authority(uuid,uuid,text[])',
    'private.agent_user_can_access_entity(uuid,uuid,text,uuid,text)',
    'private.resolve_opportunity_client_id(uuid,uuid)',
    'private.canonical_agent_projection_json(jsonb)',
    'private.agent_rfc3339_utc(timestamp with time zone)',
    'private.agent_uuid_from_legacy_text(text)',
    'private.reprove_agent_read_jsonb_for_manifest(jsonb,text)',
    'private.agent_set_jsonb_key_recursive(jsonb,text,jsonb)',
    'private.agent_jsonb_objects(jsonb)',
    'extensions.digest(bytea,text)',
    'public.read_agent_job_communication_context_as_system(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,text,text,text,text,text,uuid,text)',
    'public.read_agent_job_participants_as_system(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,text,text,text,uuid,text)',
    'public.read_agent_job_conversation_context_as_system(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,text,uuid,integer,text[],uuid)',
    'public.read_agent_correspondence_evidence_as_system(text,uuid,uuid,text,text[],text,text,text,text,text,text[])',
    'public.read_agent_scheduled_jobs_as_system(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,timestamp with time zone,timestamp with time zone,text[],text[],text,timestamp with time zone,bigint,timestamp with time zone,uuid,integer)',
    'public.read_agent_job_readiness_issues_as_system(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,text,timestamp with time zone,timestamp with time zone,text[],timestamp with time zone,bigint,timestamp with time zone,uuid,integer)',
    'public.read_agent_customer_jobs_as_system(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,uuid,text[],text[],text[],text[],text,timestamp with time zone,timestamp with time zone,timestamp with time zone,bigint,timestamp with time zone,text,uuid,integer)',
    'public.read_agent_job_summary_as_system(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,text,text,text,text,text,text,text,uuid,text[],text[],text[])',
    'public.read_agent_correspondence_evidence_page_as_system(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,uuid,text[],text)',
    'public.read_agent_job_history_as_system(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,text,text,text,text,text,text,text,uuid,text[],jsonb,timestamp with time zone,timestamp with time zone,text[],timestamp with time zone,bigint,bigint,bigint,timestamp with time zone,text,text,integer)',
    'public.read_agent_phase_c_job_conversation_context_as_system(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,text,uuid,integer,text[],uuid,bigint,uuid,uuid,text,uuid,uuid,uuid)'
  ] loop
    if to_regprocedure(v_signature) is null then
      raise exception 'agent_discovery_reads_prerequisite_missing: %',
        v_signature using errcode = '55000';
    end if;
  end loop;

  foreach v_relation in array array[
    'public.companies',
    'public.clients',
    'public.sub_clients',
    'public.opportunities',
    'public.projects',
    'public.project_tasks',
    'public.project_notes',
    'private.agent_operational_read_revisions'
  ] loop
    if to_regclass(v_relation) is null then
      raise exception 'agent_discovery_reads_prerequisite_missing: %',
        v_relation using errcode = '55000';
    end if;
  end loop;
end;
$prerequisites$;

-- Search canonicalization is deliberately narrower than duplicate-detection
-- normalization: it preserves business words and non-ASCII letters. Invalid
-- source text maps to NULL so it cannot enter an index or a public projection.
create or replace function private.agent_trim_discovery_display_text(
  p_value text
) returns text
language sql
immutable
strict
set search_path = pg_catalog, pg_temp
as $function$
  select btrim(
    p_value,
    chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(32) ||
    chr(160) || chr(5760) || chr(8192) || chr(8193) || chr(8194) ||
    chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) ||
    chr(8200) || chr(8201) || chr(8202) || chr(8232) || chr(8233) ||
    chr(8239) || chr(8287) || chr(12288) || chr(65279)
  )
$function$;

revoke all on function private.agent_trim_discovery_display_text(text)
  from public, anon, authenticated, service_role;

-- Generated from Unicode 15.0.0 DerivedAge.txt, excluding the 66
-- Noncharacter_Code_Point values in PropList.txt (707 scalar ranges).
-- DerivedAge SHA-256:
-- 7570877e0fa197c45338f7c41a02636da4e14c8dba6a3611a01cd30bf329d5ca
-- PropList SHA-256:
-- e05c0a2811d113dae4abd832884199a3ea8d187ee1b872d8240a788a96540bfd
-- Generated SQL literal SHA-256:
-- 42e74e70413868b4af535c138449f39f64cb39c73a7cd0d2e70b674e18d4f365
-- Production PostgreSQL 17.6 reports ICU Unicode 15.0; this fixed repertoire
-- prevents newer Node Unicode tables from creating cross-runtime identities.
create or replace function private.agent_discovery_unicode15_text_is_supported(
  p_value text
) returns boolean
language sql
immutable
strict
set search_path = pg_catalog, pg_temp
as $function$
  select not exists (
    select 1
    from generate_series(1, char_length(p_value)) scalar(position)
    where not (
      ascii(substr(p_value, scalar.position, 1)) <@
        '{[0,888),[890,896),[900,907),[908,909),[910,930),[931,1328),[1329,1367),[1369,1419),[1421,1424),[1425,1480),[1488,1515),[1519,1525),[1536,1806),[1807,1867),[1869,1970),[1984,2043),[2045,2094),[2096,2111),[2112,2140),[2142,2143),[2144,2155),[2160,2191),[2192,2194),[2200,2436),[2437,2445),[2447,2449),[2451,2473),[2474,2481),[2482,2483),[2486,2490),[2492,2501),[2503,2505),[2507,2511),[2519,2520),[2524,2526),[2527,2532),[2534,2559),[2561,2564),[2565,2571),[2575,2577),[2579,2601),[2602,2609),[2610,2612),[2613,2615),[2616,2618),[2620,2621),[2622,2627),[2631,2633),[2635,2638),[2641,2642),[2649,2653),[2654,2655),[2662,2679),[2689,2692),[2693,2702),[2703,2706),[2707,2729),[2730,2737),[2738,2740),[2741,2746),[2748,2758),[2759,2762),[2763,2766),[2768,2769),[2784,2788),[2790,2802),[2809,2816),[2817,2820),[2821,2829),[2831,2833),[2835,2857),[2858,2865),[2866,2868),[2869,2874),[2876,2885),[2887,2889),[2891,2894),[2901,2904),[2908,2910),[2911,2916),[2918,2936),[2946,2948),[2949,2955),[2958,2961),[2962,2966),[2969,2971),[2972,2973),[2974,2976),[2979,2981),[2984,2987),[2990,3002),[3006,3011),[3014,3017),[3018,3022),[3024,3025),[3031,3032),[3046,3067),[3072,3085),[3086,3089),[3090,3113),[3114,3130),[3132,3141),[3142,3145),[3146,3150),[3157,3159),[3160,3163),[3165,3166),[3168,3172),[3174,3184),[3191,3213),[3214,3217),[3218,3241),[3242,3252),[3253,3258),[3260,3269),[3270,3273),[3274,3278),[3285,3287),[3293,3295),[3296,3300),[3302,3312),[3313,3316),[3328,3341),[3342,3345),[3346,3397),[3398,3401),[3402,3408),[3412,3428),[3430,3456),[3457,3460),[3461,3479),[3482,3506),[3507,3516),[3517,3518),[3520,3527),[3530,3531),[3535,3541),[3542,3543),[3544,3552),[3558,3568),[3570,3573),[3585,3643),[3647,3676),[3713,3715),[3716,3717),[3718,3723),[3724,3748),[3749,3750),[3751,3774),[3776,3781),[3782,3783),[3784,3791),[3792,3802),[3804,3808),[3840,3912),[3913,3949),[3953,3992),[3993,4029),[4030,4045),[4046,4059),[4096,4294),[4295,4296),[4301,4302),[4304,4681),[4682,4686),[4688,4695),[4696,4697),[4698,4702),[4704,4745),[4746,4750),[4752,4785),[4786,4790),[4792,4799),[4800,4801),[4802,4806),[4808,4823),[4824,4881),[4882,4886),[4888,4955),[4957,4989),[4992,5018),[5024,5110),[5112,5118),[5120,5789),[5792,5881),[5888,5910),[5919,5943),[5952,5972),[5984,5997),[5998,6001),[6002,6004),[6016,6110),[6112,6122),[6128,6138),[6144,6170),[6176,6265),[6272,6315),[6320,6390),[6400,6431),[6432,6444),[6448,6460),[6464,6465),[6468,6510),[6512,6517),[6528,6572),[6576,6602),[6608,6619),[6622,6684),[6686,6751),[6752,6781),[6783,6794),[6800,6810),[6816,6830),[6832,6863),[6912,6989),[6992,7039),[7040,7156),[7164,7224),[7227,7242),[7245,7305),[7312,7355),[7357,7368),[7376,7419),[7424,7958),[7960,7966),[7968,8006),[8008,8014),[8016,8024),[8025,8026),[8027,8028),[8029,8030),[8031,8062),[8064,8117),[8118,8133),[8134,8148),[8150,8156),[8157,8176),[8178,8181),[8182,8191),[8192,8293),[8294,8306),[8308,8335),[8336,8349),[8352,8385),[8400,8433),[8448,8588),[8592,9255),[9280,9291),[9312,11124),[11126,11158),[11159,11508),[11513,11558),[11559,11560),[11565,11566),[11568,11624),[11631,11633),[11647,11671),[11680,11687),[11688,11695),[11696,11703),[11704,11711),[11712,11719),[11720,11727),[11728,11735),[11736,11743),[11744,11870),[11904,11930),[11931,12020),[12032,12246),[12272,12284),[12288,12352),[12353,12439),[12441,12544),[12549,12592),[12593,12687),[12688,12772),[12784,12831),[12832,42125),[42128,42183),[42192,42540),[42560,42744),[42752,42955),[42960,42962),[42963,42964),[42965,42970),[42994,43053),[43056,43066),[43072,43128),[43136,43206),[43214,43226),[43232,43348),[43359,43389),[43392,43470),[43471,43482),[43486,43519),[43520,43575),[43584,43598),[43600,43610),[43612,43715),[43739,43767),[43777,43783),[43785,43791),[43793,43799),[43808,43815),[43816,43823),[43824,43884),[43888,44014),[44016,44026),[44032,55204),[55216,55239),[55243,55292),[57344,64110),[64112,64218),[64256,64263),[64275,64280),[64285,64311),[64312,64317),[64318,64319),[64320,64322),[64323,64325),[64326,64451),[64467,64912),[64914,64968),[64975,64976),[65008,65050),[65056,65107),[65108,65127),[65128,65132),[65136,65141),[65142,65277),[65279,65280),[65281,65471),[65474,65480),[65482,65488),[65490,65496),[65498,65501),[65504,65511),[65512,65519),[65529,65534),[65536,65548),[65549,65575),[65576,65595),[65596,65598),[65599,65614),[65616,65630),[65664,65787),[65792,65795),[65799,65844),[65847,65935),[65936,65949),[65952,65953),[66000,66046),[66176,66205),[66208,66257),[66272,66300),[66304,66340),[66349,66379),[66384,66427),[66432,66462),[66463,66500),[66504,66518),[66560,66718),[66720,66730),[66736,66772),[66776,66812),[66816,66856),[66864,66916),[66927,66939),[66940,66955),[66956,66963),[66964,66966),[66967,66978),[66979,66994),[66995,67002),[67003,67005),[67072,67383),[67392,67414),[67424,67432),[67456,67462),[67463,67505),[67506,67515),[67584,67590),[67592,67593),[67594,67638),[67639,67641),[67644,67645),[67647,67670),[67671,67743),[67751,67760),[67808,67827),[67828,67830),[67835,67868),[67871,67898),[67903,67904),[67968,68024),[68028,68048),[68050,68100),[68101,68103),[68108,68116),[68117,68120),[68121,68150),[68152,68155),[68159,68169),[68176,68185),[68192,68256),[68288,68327),[68331,68343),[68352,68406),[68409,68438),[68440,68467),[68472,68498),[68505,68509),[68521,68528),[68608,68681),[68736,68787),[68800,68851),[68858,68904),[68912,68922),[69216,69247),[69248,69290),[69291,69294),[69296,69298),[69373,69416),[69424,69466),[69488,69514),[69552,69580),[69600,69623),[69632,69710),[69714,69750),[69759,69827),[69837,69838),[69840,69865),[69872,69882),[69888,69941),[69942,69960),[69968,70007),[70016,70112),[70113,70133),[70144,70162),[70163,70210),[70272,70279),[70280,70281),[70282,70286),[70287,70302),[70303,70314),[70320,70379),[70384,70394),[70400,70404),[70405,70413),[70415,70417),[70419,70441),[70442,70449),[70450,70452),[70453,70458),[70459,70469),[70471,70473),[70475,70478),[70480,70481),[70487,70488),[70493,70500),[70502,70509),[70512,70517),[70656,70748),[70749,70754),[70784,70856),[70864,70874),[71040,71094),[71096,71134),[71168,71237),[71248,71258),[71264,71277),[71296,71354),[71360,71370),[71424,71451),[71453,71468),[71472,71495),[71680,71740),[71840,71923),[71935,71943),[71945,71946),[71948,71956),[71957,71959),[71960,71990),[71991,71993),[71995,72007),[72016,72026),[72096,72104),[72106,72152),[72154,72165),[72192,72264),[72272,72355),[72368,72441),[72448,72458),[72704,72713),[72714,72759),[72760,72774),[72784,72813),[72816,72848),[72850,72872),[72873,72887),[72960,72967),[72968,72970),[72971,73015),[73018,73019),[73020,73022),[73023,73032),[73040,73050),[73056,73062),[73063,73065),[73066,73103),[73104,73106),[73107,73113),[73120,73130),[73440,73465),[73472,73489),[73490,73531),[73534,73562),[73648,73649),[73664,73714),[73727,74650),[74752,74863),[74864,74869),[74880,75076),[77712,77811),[77824,78934),[82944,83527),[92160,92729),[92736,92767),[92768,92778),[92782,92863),[92864,92874),[92880,92910),[92912,92918),[92928,92998),[93008,93018),[93019,93026),[93027,93048),[93053,93072),[93760,93851),[93952,94027),[94031,94088),[94095,94112),[94176,94181),[94192,94194),[94208,100344),[100352,101590),[101632,101641),[110576,110580),[110581,110588),[110589,110591),[110592,110883),[110898,110899),[110928,110931),[110933,110934),[110948,110952),[110960,111356),[113664,113771),[113776,113789),[113792,113801),[113808,113818),[113820,113828),[118528,118574),[118576,118599),[118608,118724),[118784,119030),[119040,119079),[119081,119275),[119296,119366),[119488,119508),[119520,119540),[119552,119639),[119648,119673),[119808,119893),[119894,119965),[119966,119968),[119970,119971),[119973,119975),[119977,119981),[119982,119994),[119995,119996),[119997,120004),[120005,120070),[120071,120075),[120077,120085),[120086,120093),[120094,120122),[120123,120127),[120128,120133),[120134,120135),[120138,120145),[120146,120486),[120488,120780),[120782,121484),[121499,121504),[121505,121520),[122624,122655),[122661,122667),[122880,122887),[122888,122905),[122907,122914),[122915,122917),[122918,122923),[122928,122990),[123023,123024),[123136,123181),[123184,123198),[123200,123210),[123214,123216),[123536,123567),[123584,123642),[123647,123648),[124112,124154),[124896,124903),[124904,124908),[124909,124911),[124912,124927),[124928,125125),[125127,125143),[125184,125260),[125264,125274),[125278,125280),[126065,126133),[126209,126270),[126464,126468),[126469,126496),[126497,126499),[126500,126501),[126503,126504),[126505,126515),[126516,126520),[126521,126522),[126523,126524),[126530,126531),[126535,126536),[126537,126538),[126539,126540),[126541,126544),[126545,126547),[126548,126549),[126551,126552),[126553,126554),[126555,126556),[126557,126558),[126559,126560),[126561,126563),[126564,126565),[126567,126571),[126572,126579),[126580,126584),[126585,126589),[126590,126591),[126592,126602),[126603,126620),[126625,126628),[126629,126634),[126635,126652),[126704,126706),[126976,127020),[127024,127124),[127136,127151),[127153,127168),[127169,127184),[127185,127222),[127232,127406),[127462,127491),[127504,127548),[127552,127561),[127568,127570),[127584,127590),[127744,128728),[128732,128749),[128752,128765),[128768,128887),[128891,128986),[128992,129004),[129008,129009),[129024,129036),[129040,129096),[129104,129114),[129120,129160),[129168,129198),[129200,129202),[129280,129620),[129632,129646),[129648,129661),[129664,129673),[129680,129726),[129727,129734),[129742,129756),[129760,129769),[129776,129785),[129792,129939),[129940,129995),[130032,130042),[131072,173792),[173824,177978),[177984,178206),[178208,183970),[183984,191457),[194560,195102),[196608,201547),[201552,205744),[917505,917506),[917536,917632),[917760,918000),[983040,1048574),[1048576,1114110)}'::int4multirange
    )
  );
$function$;

revoke all on function private.agent_discovery_unicode15_text_is_supported(text)
  from public, anon, authenticated, service_role;

create or replace function private.agent_normalize_discovery_text(
  p_value text
) returns text
language plpgsql
immutable
strict
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_value text;
begin
  if not private.agent_discovery_unicode15_text_is_supported(p_value)
     or octet_length(p_value) > 8192
     or p_value collate "und-x-icu" ~ '[[:cntrl:]]'
     or position(chr(1564) in p_value) > 0
     or position(chr(8206) in p_value) > 0
     or position(chr(8207) in p_value) > 0
     or position(chr(8234) in p_value) > 0
     or position(chr(8235) in p_value) > 0
     or position(chr(8236) in p_value) > 0
     or position(chr(8237) in p_value) > 0
     or position(chr(8238) in p_value) > 0
     or position(chr(8294) in p_value) > 0
     or position(chr(8295) in p_value) > 0
     or position(chr(8296) in p_value) > 0
     or position(chr(8297) in p_value) > 0
     or position(chr(65279) in p_value) > 0 then
    return null;
  end if;
  v_value := lower(private.agent_trim_discovery_display_text(
    regexp_replace(
      normalize(p_value, NFKC) collate "und-x-icu",
      '[[:space:]]+',
      ' ',
      'g'
    )
  ) collate "und-x-icu");
  if v_value = '' then
    return null;
  end if;
  return v_value;
end;
$function$;

revoke all on function private.agent_normalize_discovery_text(text)
  from public, anon, authenticated, service_role;

create or replace function private.agent_discovery_query_is_valid(
  p_value text
) returns boolean
language plpgsql
immutable
strict
set search_path = pg_catalog, private, pg_temp
as $function$
declare
  v_tokens text[];
begin
  if p_value is distinct from
       private.agent_normalize_discovery_text(p_value)
     or char_length(p_value) not between 2 and 200 then
    return false;
  end if;
  v_tokens := regexp_split_to_array(p_value, ' ');
  if cardinality(v_tokens) > 8 then
    return false;
  end if;
  if exists (
    select 1
    from unnest(v_tokens) token(value)
    where char_length(token.value) not between 2 and 64
  ) then
    return false;
  end if;
  return true;
end;
$function$;

revoke all on function private.agent_discovery_query_is_valid(text)
  from public, anon, authenticated, service_role;

create or replace function private.agent_normalize_discovery_email(
  p_value text
) returns text
language plpgsql
immutable
strict
set search_path = pg_catalog, private, pg_temp
as $function$
declare
  v_value text;
begin
  v_value := private.agent_normalize_discovery_text(p_value);
  if v_value is null
     or char_length(v_value) not between 3 and 200
     or v_value ~ '[[:space:]]'
     or position('@' in v_value) not between 2 and 65
     or octet_length(split_part(v_value, '@', 1)) > 64
     or v_value !~ '^[a-z0-9!#$%&''*+/=?^_`{|}~-]+(?:[.][a-z0-9!#$%&''*+/=?^_`{|}~-]+)*@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:[.][a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$' then
    return null;
  end if;
  return v_value;
end;
$function$;

revoke all on function private.agent_normalize_discovery_email(text)
  from public, anon, authenticated, service_role;

create or replace function private.agent_normalize_discovery_phone(
  p_value text
) returns text
language plpgsql
immutable
strict
set search_path = pg_catalog, private, pg_temp
as $function$
declare
  v_value text;
  v_national text;
begin
  v_value := private.agent_normalize_discovery_text(p_value);
  if v_value is null or v_value !~ '^[+0-9(). -]+$' then
    return null;
  end if;
  v_value := regexp_replace(v_value, '[(). -]', '', 'g');
  if left(v_value, 2) = '+1' then
    v_national := substr(v_value, 3);
  elsif char_length(v_value) = 10 and left(v_value, 1) <> '+' then
    v_national := v_value;
  else
    return null;
  end if;
  if v_national !~ '^[2-9][0-9]{2}[2-9][0-9]{6}$' then
    return null;
  end if;
  return '+1' || v_national;
end;
$function$;

revoke all on function private.agent_normalize_discovery_phone(text)
  from public, anon, authenticated, service_role;

create or replace function private.agent_escape_like_literal(
  p_value text
) returns text
language sql
immutable
strict
set search_path = pg_catalog, pg_temp
as $function$
  select replace(
    replace(replace(p_value, '\', '\\'), '%', '\%'),
    '_', '\_'
  );
$function$;

revoke all on function private.agent_escape_like_literal(text)
  from public, anon, authenticated, service_role;

create or replace function private.agent_discovery_prefix_upper_bound(
  p_value text
) returns text
language plpgsql
immutable
strict
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_length integer;
  v_last_scalar integer;
begin
  v_length := char_length(p_value);
  if v_length = 0 then
    return null;
  end if;
  v_last_scalar := ascii(substr(p_value, v_length, 1));
  if v_last_scalar >= 1114111 then
    return null;
  end if;
  if v_last_scalar = 55295 then
    v_last_scalar := 57344;
  else
    v_last_scalar := v_last_scalar + 1;
  end if;
  return left(p_value, v_length - 1) || chr(v_last_scalar);
end;
$function$;

revoke all on function private.agent_discovery_prefix_upper_bound(text)
  from public, anon, authenticated, service_role;

create or replace function private.agent_discovery_opportunity_source_is_invalid(
  p_client_ref uuid,
  p_client_id uuid,
  p_project_ref uuid,
  p_project_id uuid,
  p_title text,
  p_address text,
  p_stage text,
  p_created_at timestamptz,
  p_updated_at timestamptz,
  p_archived_at timestamptz
) returns boolean
language sql
immutable
set search_path = pg_catalog, private, pg_temp
as $function$
  select coalesce(
    p_client_ref is not null
      and p_client_id is not null
      and p_client_ref is distinct from p_client_id
    or p_project_ref is not null
      and p_project_id is not null
      and p_project_ref is distinct from p_project_id
    or p_title is null
    or nullif(private.agent_trim_discovery_display_text(p_title), '') is null
    or octet_length(
      private.agent_trim_discovery_display_text(p_title)
    ) > 1000
    or private.agent_normalize_discovery_text(p_title) is null
    or p_address is not null and (
      nullif(
        private.agent_trim_discovery_display_text(p_address), ''
      ) is null
      or octet_length(
        private.agent_trim_discovery_display_text(p_address)
      ) > 2000
      or private.agent_normalize_discovery_text(p_address) is null
    )
    or p_stage is null
    or p_stage not in (
      'new_lead', 'qualifying', 'quoting', 'quoted', 'follow_up',
      'negotiation', 'won', 'lost', 'discarded'
    )
    or p_created_at is null
    or p_updated_at is null
    or not isfinite(p_created_at)
    or not isfinite(p_updated_at)
    or extract(year from p_created_at at time zone 'UTC')
      not between 1 and 9999
    or extract(year from p_updated_at at time zone 'UTC')
      not between 1 and 9999
    or p_archived_at is not null and not isfinite(p_archived_at)
    or p_created_at > p_updated_at,
    true
  );
$function$;

revoke all on function private.agent_discovery_opportunity_source_is_invalid(
  uuid, uuid, uuid, uuid, text, text, text, timestamptz, timestamptz,
  timestamptz
) from public, anon, authenticated, service_role;

create or replace function private.agent_discovery_project_source_is_invalid(
  p_opportunity_id text,
  p_opportunity_ref uuid,
  p_title text,
  p_address text,
  p_status text,
  p_created_at timestamptz,
  p_updated_at timestamptz,
  p_start_date timestamptz,
  p_end_date timestamptz
) returns boolean
language sql
immutable
set search_path = pg_catalog, private, pg_temp
as $function$
  select coalesce(
    p_opportunity_id is not null
      and private.agent_uuid_from_legacy_text(p_opportunity_id) is null
    or p_opportunity_ref is not null
      and p_opportunity_id is not null
      and p_opportunity_ref is distinct from
        private.agent_uuid_from_legacy_text(p_opportunity_id)
    or p_title is null
    or nullif(private.agent_trim_discovery_display_text(p_title), '') is null
    or octet_length(
      private.agent_trim_discovery_display_text(p_title)
    ) > 1000
    or private.agent_normalize_discovery_text(p_title) is null
    or p_address is not null and (
      nullif(
        private.agent_trim_discovery_display_text(p_address), ''
      ) is null
      or octet_length(
        private.agent_trim_discovery_display_text(p_address)
      ) > 2000
      or private.agent_normalize_discovery_text(p_address) is null
    )
    or p_status is null
    or p_status not in (
      'rfq', 'estimated', 'accepted', 'in_progress', 'completed',
      'closed', 'archived'
    )
    or p_created_at is null
    or p_updated_at is null
    or not isfinite(p_created_at)
    or not isfinite(p_updated_at)
    or extract(year from p_created_at at time zone 'UTC')
      not between 1 and 9999
    or extract(year from p_updated_at at time zone 'UTC')
      not between 1 and 9999
    or p_created_at > p_updated_at
    or p_start_date is not null and (
      not isfinite(p_start_date)
      or extract(year from p_start_date at time zone 'UTC')
        not between 1 and 9999
    )
    or p_end_date is not null and (
      not isfinite(p_end_date)
      or extract(year from p_end_date at time zone 'UTC')
        not between 1 and 9999
    ),
    true
  );
$function$;

revoke all on function private.agent_discovery_project_source_is_invalid(
  text, uuid, text, text, text, timestamptz, timestamptz, timestamptz,
  timestamptz
) from public, anon, authenticated, service_role;

-- These pure, immutable helpers are evaluated by PostgreSQL while maintaining
-- discovery expression and partial indexes. Every role with DML privileges on
-- the indexed source tables must be able to execute the complete helper graph;
-- otherwise an otherwise-authorized write fails before RLS can complete.
-- The private schema is not exposed through PostgREST, and the helpers accept
-- only caller-supplied scalars, so this grant exposes no operational rows.
grant execute on function private.agent_trim_discovery_display_text(text)
  to anon, authenticated, service_role;
grant execute on function private.agent_discovery_unicode15_text_is_supported(text)
  to anon, authenticated, service_role;
grant execute on function private.agent_normalize_discovery_text(text)
  to anon, authenticated, service_role;
grant execute on function private.agent_normalize_discovery_email(text)
  to anon, authenticated, service_role;
grant execute on function private.agent_normalize_discovery_phone(text)
  to anon, authenticated, service_role;
grant execute on function private.agent_discovery_opportunity_source_is_invalid(
  uuid, uuid, uuid, uuid, text, text, text, timestamptz, timestamptz,
  timestamptz
) to anon, authenticated, service_role;
grant execute on function private.agent_discovery_project_source_is_invalid(
  text, uuid, text, text, text, timestamptz, timestamptz, timestamptz,
  timestamptz
) to anon, authenticated, service_role;
grant execute on function private.agent_uuid_from_legacy_text(text)
  to anon, authenticated, service_role;

-- Exact/prefix btrees keep two-character searches indexed. Trigram indexes
-- serve literal all-token matching. Every index excludes retired rows.
create index if not exists clients_agent_discovery_name_prefix_idx
  on public.clients (
    company_id,
    (left(private.agent_normalize_discovery_text(name), 200) collate "C"),
    id asc
  )
  where deleted_at is null and merged_into_client_id is null;
create index if not exists clients_agent_discovery_name_trgm_idx
  on public.clients using gin (
    (private.agent_normalize_discovery_text(name) collate "C")
      gin_trgm_ops
  )
  where deleted_at is null and merged_into_client_id is null;
create index if not exists clients_agent_discovery_exact_email_idx
  on public.clients (
    company_id,
    private.agent_normalize_discovery_email(email),
    (left(private.agent_normalize_discovery_text(name), 200) collate "C"),
    id asc
  )
  where deleted_at is null and merged_into_client_id is null;
create index if not exists clients_agent_discovery_exact_phone_idx
  on public.clients (
    company_id,
    private.agent_normalize_discovery_phone(phone_number),
    (left(private.agent_normalize_discovery_text(name), 200) collate "C"),
    id asc
  )
  where deleted_at is null and merged_into_client_id is null;

create index if not exists sub_clients_agent_discovery_name_prefix_idx
  on public.sub_clients (
    company_id,
    (left(private.agent_normalize_discovery_text(name), 200) collate "C"),
    id asc
  ) where deleted_at is null;
create index if not exists sub_clients_agent_discovery_name_trgm_idx
  on public.sub_clients using gin (
    (private.agent_normalize_discovery_text(name) collate "C")
      gin_trgm_ops
  ) where deleted_at is null;
create index if not exists sub_clients_agent_discovery_exact_email_idx
  on public.sub_clients (
    company_id,
    private.agent_normalize_discovery_email(email),
    (left(private.agent_normalize_discovery_text(name), 200) collate "C"),
    id asc
  ) where deleted_at is null;
create index if not exists sub_clients_agent_discovery_exact_phone_idx
  on public.sub_clients (
    company_id,
    private.agent_normalize_discovery_phone(phone_number),
    (left(private.agent_normalize_discovery_text(name), 200) collate "C"),
    id asc
  ) where deleted_at is null;

create index if not exists opportunities_agent_discovery_title_prefix_idx
  on public.opportunities (
    company_id,
    (left(private.agent_normalize_discovery_text(title), 200) collate "C"),
    id asc
  ) where deleted_at is null and merged_into_opportunity_id is null;
create index if not exists opportunities_agent_discovery_title_trgm_idx
  on public.opportunities using gin (
    (private.agent_normalize_discovery_text(title) collate "C")
      gin_trgm_ops
  ) where deleted_at is null and merged_into_opportunity_id is null;
create index if not exists opportunities_agent_discovery_address_prefix_idx
  on public.opportunities (
    company_id,
    (left(private.agent_normalize_discovery_text(address), 200) collate "C"),
    id asc
  ) where deleted_at is null and merged_into_opportunity_id is null
    ;
create index if not exists opportunities_agent_discovery_address_trgm_idx
  on public.opportunities using gin (
    (private.agent_normalize_discovery_text(address) collate "C")
      gin_trgm_ops
  ) where deleted_at is null and merged_into_opportunity_id is null
    ;
create index if not exists opportunities_agent_discovery_created_keyset_idx
  on public.opportunities (
    company_id,
    date_trunc('milliseconds', created_at, 'UTC') desc nulls last,
    id asc
  )
  where deleted_at is null and merged_into_opportunity_id is null;
create index if not exists opportunities_agent_discovery_updated_keyset_idx
  on public.opportunities (
    company_id,
    date_trunc('milliseconds', updated_at, 'UTC') desc nulls last,
    id asc
  )
  where deleted_at is null and merged_into_opportunity_id is null;
create index if not exists opportunities_agent_discovery_updated_stage_archive_idx
  on public.opportunities (
    company_id,
    stage,
    (archived_at is not null),
    date_trunc('milliseconds', updated_at, 'UTC') desc nulls last,
    id asc
  )
  where deleted_at is null and merged_into_opportunity_id is null;
create index if not exists opportunities_agent_discovery_invalid_stage_updated_idx
  on public.opportunities (
    company_id,
    date_trunc('milliseconds', updated_at, 'UTC') desc nulls last,
    id asc
  )
  where deleted_at is null
    and merged_into_opportunity_id is null
    and (stage is null or stage not in (
      'new_lead', 'qualifying', 'quoting', 'quoted', 'follow_up',
      'negotiation', 'won', 'lost', 'discarded'
    ));

create index if not exists projects_agent_discovery_title_prefix_idx
  on public.projects (
    company_id,
    (left(private.agent_normalize_discovery_text(title), 200) collate "C"),
    id asc
  ) where deleted_at is null;
create index if not exists projects_agent_discovery_title_trgm_idx
  on public.projects using gin (
    (private.agent_normalize_discovery_text(title) collate "C")
      gin_trgm_ops
  ) where deleted_at is null;
create index if not exists projects_agent_discovery_address_prefix_idx
  on public.projects (
    company_id,
    (left(private.agent_normalize_discovery_text(address), 200) collate "C"),
    id asc
  ) where deleted_at is null;
create index if not exists projects_agent_discovery_address_trgm_idx
  on public.projects using gin (
    (private.agent_normalize_discovery_text(address) collate "C")
      gin_trgm_ops
  ) where deleted_at is null;
create index if not exists projects_agent_discovery_created_keyset_idx
  on public.projects (
    company_id,
    date_trunc('milliseconds', created_at, 'UTC') desc nulls last,
    id asc
  )
  where deleted_at is null;
create index if not exists projects_agent_discovery_updated_keyset_idx
  on public.projects (
    company_id,
    date_trunc('milliseconds', updated_at, 'UTC') desc nulls last,
    id asc
  )
  where deleted_at is null;
create index if not exists projects_agent_discovery_updated_status_idx
  on public.projects (
    company_id,
    status,
    date_trunc('milliseconds', updated_at, 'UTC') desc nulls last,
    id asc
  )
  where deleted_at is null;
create index if not exists projects_agent_discovery_invalid_status_updated_idx
  on public.projects (
    company_id,
    date_trunc('milliseconds', updated_at, 'UTC') desc nulls last,
    id asc
  )
  where deleted_at is null and (status is null or status not in (
    'rfq', 'estimated', 'accepted', 'in_progress', 'completed',
    'closed', 'archived'
  ));

-- Prefix keys are capped at the maximum normalized query length, so malformed
-- source text can never exceed PostgreSQL's btree tuple limit. Separate
-- company/id sentinels keep malformed active rows visible to the fixed readers
-- without indexing their unbounded business strings.
create index if not exists clients_agent_discovery_invalid_source_idx
  on public.clients (company_id, id asc)
  where deleted_at is null
    and merged_into_client_id is null
    and (
      nullif(private.agent_trim_discovery_display_text(name), '') is null
      or octet_length(private.agent_trim_discovery_display_text(name)) > 1000
      or private.agent_normalize_discovery_text(name) is null
    );
create index if not exists sub_clients_agent_discovery_invalid_source_idx
  on public.sub_clients (company_id, id asc)
  where deleted_at is null
    and (
      nullif(private.agent_trim_discovery_display_text(name), '') is null
      or octet_length(private.agent_trim_discovery_display_text(name)) > 1000
      or private.agent_normalize_discovery_text(name) is null
    );
create index if not exists sub_clients_agent_discovery_parent_idx
  on public.sub_clients (company_id, client_id, id asc)
  where deleted_at is null;
create index if not exists opportunities_agent_discovery_invalid_source_idx
  on public.opportunities (company_id, id asc)
  where deleted_at is null
    and merged_into_opportunity_id is null
    and private.agent_discovery_opportunity_source_is_invalid(
      client_ref,
      client_id,
      project_ref,
      project_id,
      title,
      address,
      stage,
      created_at,
      updated_at,
      archived_at
    );
create index if not exists projects_agent_discovery_invalid_source_idx
  on public.projects (company_id, id asc)
  where deleted_at is null
    and private.agent_discovery_project_source_is_invalid(
      opportunity_id,
      opportunity_ref,
      title,
      address,
      status,
      created_at,
      updated_at,
      start_date,
      end_date
    );

-- Assigned reads begin from assignment-bearing rows instead of walking a
-- tenant-wide search/keyset index and invoking the policy helper per row.
create index if not exists project_tasks_agent_discovery_team_members_idx
  on public.project_tasks using gin (team_member_ids)
  where deleted_at is null;
create index if not exists project_tasks_agent_discovery_project_idx
  on public.project_tasks (project_id, id asc)
  where deleted_at is null;
create index if not exists project_notes_agent_discovery_mentions_idx
  on public.project_notes using gin (mentioned_user_ids)
  where deleted_at is null;
create index if not exists project_notes_agent_discovery_project_idx
  on public.project_notes (
    private.agent_uuid_from_legacy_text(project_id), id asc
  ) where deleted_at is null
    and private.agent_uuid_from_legacy_text(project_id) is not null;
create index if not exists projects_agent_discovery_client_idx
  on public.projects (company_id, client_id, id asc)
  where deleted_at is null and client_id is not null;
create index if not exists opportunities_agent_discovery_assigned_idx
  on public.opportunities (company_id, assigned_to, id asc)
  where deleted_at is null
    and merged_into_opportunity_id is null
    and assigned_to is not null;
create index if not exists opportunities_agent_discovery_assigned_title_prefix_idx
  on public.opportunities (
    company_id,
    assigned_to,
    (left(private.agent_normalize_discovery_text(title), 200) collate "C"),
    id asc
  ) where deleted_at is null
    and merged_into_opportunity_id is null
    and assigned_to is not null;
create index if not exists opportunities_agent_discovery_assigned_address_prefix_idx
  on public.opportunities (
    company_id,
    assigned_to,
    (left(private.agent_normalize_discovery_text(address), 200) collate "C"),
    id asc
  ) where deleted_at is null
    and merged_into_opportunity_id is null
    and assigned_to is not null;
create index if not exists opportunities_agent_discovery_assigned_created_keyset_idx
  on public.opportunities (
    company_id,
    assigned_to,
    date_trunc('milliseconds', created_at, 'UTC') desc nulls last,
    id asc
  ) where deleted_at is null
    and merged_into_opportunity_id is null
    and assigned_to is not null;
create index if not exists opportunities_agent_discovery_assigned_updated_keyset_idx
  on public.opportunities (
    company_id,
    assigned_to,
    date_trunc('milliseconds', updated_at, 'UTC') desc nulls last,
    id asc
  ) where deleted_at is null
    and merged_into_opportunity_id is null
    and assigned_to is not null;
create index if not exists opportunities_agent_discovery_assigned_stage_updated_idx
  on public.opportunities (
    company_id,
    assigned_to,
    stage,
    (archived_at is not null),
    date_trunc('milliseconds', updated_at, 'UTC') desc nulls last,
    id asc
  ) where deleted_at is null
    and merged_into_opportunity_id is null
    and assigned_to is not null;

-- Reproof may change only proof hashes and canonical SourceVersion/EvidenceRef
-- version atoms. Business strings are untrusted data and must remain byte-for-
-- byte stable even when they happen to contain a previously published hash.
create or replace function private.agent_replace_agent_proof_hash(
  p_value jsonb,
  p_from text,
  p_to text
) returns jsonb
language plpgsql
immutable
strict
set search_path = pg_catalog, private, pg_temp
as $function$
declare
  v_result jsonb;
  v_is_proof boolean;
  v_is_source_atom boolean;
  v_version text;
begin
  case jsonb_typeof(p_value)
    when 'array' then
      select coalesce(
        jsonb_agg(
          private.agent_replace_agent_proof_hash(
            element.value, p_from, p_to
          ) order by element.ordinality
        ),
        '[]'::jsonb
      )
      into v_result
      from jsonb_array_elements(p_value) with ordinality
        element(value, ordinality);
      return v_result;
    when 'object' then
      v_is_proof :=
        jsonb_typeof(p_value -> 'projection') = 'object'
        and jsonb_typeof(p_value -> 'source_content_hash') = 'string'
        and p_value ->> 'source_content_hash' = p_from;
      v_version := p_value ->> 'version';
      v_is_source_atom :=
        jsonb_typeof(p_value -> 'source_domain') = 'string'
        and jsonb_typeof(p_value -> 'source_type') = 'string'
        and jsonb_typeof(p_value -> 'source_id') = 'string'
        and jsonb_typeof(p_value -> 'version') = 'string'
        and char_length(v_version) > char_length(p_from)
        and right(v_version, char_length(p_from)) = p_from
        and substr(
          v_version,
          char_length(v_version) - char_length(p_from),
          1
        ) = ':';
      select coalesce(
        jsonb_object_agg(
          member.key,
          case
            when v_is_proof and member.key = 'source_content_hash'
              then to_jsonb(p_to)
            when v_is_source_atom and member.key = 'version'
              then to_jsonb(
                left(v_version, char_length(v_version) - char_length(p_from))
                || p_to
              )
            else private.agent_replace_agent_proof_hash(
              member.value, p_from, p_to
            )
          end
        ),
        '{}'::jsonb
      )
      into v_result
      from jsonb_each(p_value) member(key, value);
      return v_result;
    else
      return p_value;
  end case;
end;
$function$;

revoke all on function private.agent_replace_agent_proof_hash(
  jsonb, text, text
) from public, anon, authenticated, service_role;

-- The same helper must still serve historical v5->v6 cores, but v7 reproof
-- accepts only a complete v6 result. A nested mixed revision fails closed.
create or replace function private.reprove_agent_read_jsonb_for_manifest(
  p_result jsonb,
  p_capability_manifest_revision text
) returns jsonb
language plpgsql
stable
strict
security definer
set search_path = pg_catalog, private, extensions, pg_temp
as $function$
declare
  v_result jsonb;
  v_object jsonb;
  v_projection jsonb;
  v_old_hash text;
  v_new_hash text;
  v_pass integer;
  v_changed boolean;
  v_manifest_count integer;
begin
  if p_capability_manifest_revision is null
     or p_capability_manifest_revision not in (
    '2026-08-14.capability-manifest.v6',
    '2026-08-20.capability-manifest.v7'
  ) then
    raise exception 'invalid_agent_manifest_reproof_request'
      using errcode = '22023';
  end if;

  if p_capability_manifest_revision =
       '2026-08-20.capability-manifest.v7' then
    select count(*)
    into v_manifest_count
    from private.agent_jsonb_objects(p_result) object_value
    where object_value ? 'capability_manifest_revision';
    if v_manifest_count = 0 or exists (
      select 1
      from private.agent_jsonb_objects(p_result) object_value
      where object_value ? 'capability_manifest_revision'
        and object_value ->> 'capability_manifest_revision' is distinct from
          '2026-08-14.capability-manifest.v6'
    ) then
      raise exception 'invalid_agent_manifest_reproof_source'
        using errcode = '22023';
    end if;
  end if;

  v_result := private.agent_set_jsonb_key_recursive(
    p_result,
    'capability_manifest_revision',
    to_jsonb(p_capability_manifest_revision)
  );

  for v_pass in 1..16 loop
    v_changed := false;
    for v_object in
      select object_value
      from private.agent_jsonb_objects(v_result) object_value
      where jsonb_typeof(object_value -> 'projection') = 'object'
        and object_value ->> 'source_content_hash'
          ~ '^sha256:[0-9a-f]{64}$'
    loop
      v_projection := v_object -> 'projection';
      v_old_hash := v_object ->> 'source_content_hash';
      v_new_hash := 'sha256:' || encode(
        extensions.digest(
          convert_to(
            private.canonical_agent_projection_json(v_projection),
            'UTF8'
          ),
          'sha256'
        ),
        'hex'
      );
      if v_new_hash is distinct from v_old_hash then
        v_result := private.agent_replace_agent_proof_hash(
          v_result,
          v_old_hash,
          v_new_hash
        );
        v_changed := true;
      end if;
    end loop;
    exit when not v_changed;
  end loop;
  if v_changed then
    raise exception 'agent_manifest_reproof_depth_exceeded'
      using errcode = '54000';
  end if;
  return v_result;
end;
$function$;

revoke all on function private.reprove_agent_read_jsonb_for_manifest(jsonb, text)
  from public, anon, authenticated, service_role;

-- Freeze every v6 implementation before recreating the public names. The raw
-- evidence helper remains public through its own v7 compatibility wrapper
-- because current internal memory/evidence code still calls it directly.
alter function public.read_agent_job_communication_context_as_system(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, text, text, text, text, text, text, uuid, text
) rename to read_agent_job_communication_context_as_system_v6_core;
alter function public.read_agent_job_communication_context_as_system_v6_core(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, text, text, text, text, text, text, uuid, text
) set schema private;
revoke all on function private.read_agent_job_communication_context_as_system_v6_core(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, text, text, text, text, text, text, uuid, text
) from public, anon, authenticated, service_role;

alter function public.read_agent_job_participants_as_system(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, text, text, text, text, uuid, text
) rename to read_agent_job_participants_as_system_v6_core;
alter function public.read_agent_job_participants_as_system_v6_core(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, text, text, text, text, uuid, text
) set schema private;
revoke all on function private.read_agent_job_participants_as_system_v6_core(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, text, text, text, text, uuid, text
) from public, anon, authenticated, service_role;

alter function public.read_agent_job_conversation_context_as_system(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, text, text, uuid, integer, text[], uuid
) rename to read_agent_job_conversation_context_as_system_v6_core;
alter function public.read_agent_job_conversation_context_as_system_v6_core(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, text, text, uuid, integer, text[], uuid
) set schema private;
revoke all on function private.read_agent_job_conversation_context_as_system_v6_core(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, text, text, uuid, integer, text[], uuid
) from public, anon, authenticated, service_role;

alter function public.read_agent_correspondence_evidence_as_system(
  text, uuid, uuid, text, text[], text, text, text, text, text, text[]
) rename to read_agent_correspondence_evidence_as_system_v6_core;
alter function public.read_agent_correspondence_evidence_as_system_v6_core(
  text, uuid, uuid, text, text[], text, text, text, text, text, text[]
) set schema private;
revoke all on function private.read_agent_correspondence_evidence_as_system_v6_core(
  text, uuid, uuid, text, text[], text, text, text, text, text, text[]
) from public, anon, authenticated, service_role;

alter function public.read_agent_scheduled_jobs_as_system(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, timestamptz, timestamptz, text[], text[], text, timestamptz,
  bigint, timestamptz, uuid, integer
) rename to read_agent_scheduled_jobs_as_system_v6_core;
alter function public.read_agent_scheduled_jobs_as_system_v6_core(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, timestamptz, timestamptz, text[], text[], text, timestamptz,
  bigint, timestamptz, uuid, integer
) set schema private;
revoke all on function private.read_agent_scheduled_jobs_as_system_v6_core(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, timestamptz, timestamptz, text[], text[], text, timestamptz,
  bigint, timestamptz, uuid, integer
) from public, anon, authenticated, service_role;

alter function public.read_agent_job_readiness_issues_as_system(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, text, text, timestamptz, timestamptz, text[], timestamptz,
  bigint, timestamptz, uuid, integer
) rename to read_agent_job_readiness_issues_as_system_v6_core;
alter function public.read_agent_job_readiness_issues_as_system_v6_core(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, text, text, timestamptz, timestamptz, text[], timestamptz,
  bigint, timestamptz, uuid, integer
) set schema private;
revoke all on function private.read_agent_job_readiness_issues_as_system_v6_core(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, text, text, timestamptz, timestamptz, text[], timestamptz,
  bigint, timestamptz, uuid, integer
) from public, anon, authenticated, service_role;

alter function public.read_agent_customer_jobs_as_system(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text, text,
  text, uuid, text[], text[], text[], text[], text, timestamptz, timestamptz,
  timestamptz, bigint, timestamptz, text, uuid, integer
) rename to read_agent_customer_jobs_as_system_v6_core;
alter function public.read_agent_customer_jobs_as_system_v6_core(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text, text,
  text, uuid, text[], text[], text[], text[], text, timestamptz, timestamptz,
  timestamptz, bigint, timestamptz, text, uuid, integer
) set schema private;
revoke all on function private.read_agent_customer_jobs_as_system_v6_core(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text, text,
  text, uuid, text[], text[], text[], text[], text, timestamptz, timestamptz,
  timestamptz, bigint, timestamptz, text, uuid, integer
) from public, anon, authenticated, service_role;

alter function public.read_agent_job_summary_as_system(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text, text,
  text, text, text, text, text, text, text, text, uuid, text[], text[], text[]
) rename to read_agent_job_summary_as_system_v6_core;
alter function public.read_agent_job_summary_as_system_v6_core(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text, text,
  text, text, text, text, text, text, text, text, uuid, text[], text[], text[]
) set schema private;
revoke all on function private.read_agent_job_summary_as_system_v6_core(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text, text,
  text, text, text, text, text, text, text, text, uuid, text[], text[], text[]
) from public, anon, authenticated, service_role;

alter function public.read_agent_correspondence_evidence_page_as_system(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text, text,
  text, uuid, text[], text
) rename to read_agent_correspondence_evidence_page_as_system_v6_core;
alter function public.read_agent_correspondence_evidence_page_as_system_v6_core(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text, text,
  text, uuid, text[], text
) set schema private;
revoke all on function private.read_agent_correspondence_evidence_page_as_system_v6_core(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text, text,
  text, uuid, text[], text
) from public, anon, authenticated, service_role;

alter function public.read_agent_job_history_as_system(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text, text,
  text, text, text, text, text, text, text, text, uuid, text[], jsonb,
  timestamptz, timestamptz, text[], timestamptz, bigint, bigint, bigint,
  timestamptz, text, text, integer
) rename to read_agent_job_history_as_system_v6_core;
alter function public.read_agent_job_history_as_system_v6_core(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text, text,
  text, text, text, text, text, text, text, text, uuid, text[], jsonb,
  timestamptz, timestamptz, text[], timestamptz, bigint, bigint, bigint,
  timestamptz, text, text, integer
) set schema private;
revoke all on function private.read_agent_job_history_as_system_v6_core(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text, text,
  text, text, text, text, text, text, text, text, uuid, text[], jsonb,
  timestamptz, timestamptz, text[], timestamptz, bigint, bigint, bigint,
  timestamptz, text, text, integer
) from public, anon, authenticated, service_role;

alter function public.read_agent_phase_c_job_conversation_context_as_system(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, text, text, uuid, integer, text[], uuid, bigint, uuid, uuid, text,
  uuid, uuid, uuid
) rename to read_agent_phase_c_job_conversation_context_as_system_v6_core;
alter function public.read_agent_phase_c_job_conversation_context_as_system_v6_core(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, text, text, uuid, integer, text[], uuid, bigint, uuid, uuid, text,
  uuid, uuid, uuid
) set schema private;
revoke all on function private.read_agent_phase_c_job_conversation_context_as_system_v6_core(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, text, text, uuid, integer, text[], uuid, bigint, uuid, uuid, text,
  uuid, uuid, uuid
) from public, anon, authenticated, service_role;

-- The frozen Phase C body used the former public context name. Rewrite that
-- one call to the private v6 core so its route/source proof remains one
-- statement after the public context name becomes v7-only.
create or replace function pg_temp.agent_bridge_phase_c_v6_core()
returns void
language plpgsql
set search_path = pg_catalog, private, pg_temp
as $function$
declare
  v_definition text;
  v_old text := 'public.read_agent_job_conversation_context_as_system(';
  v_new text := 'private.read_agent_job_conversation_context_as_system_v6_core(';
  v_count integer;
begin
  v_definition := pg_get_functiondef(to_regprocedure(
    'private.read_agent_phase_c_job_conversation_context_as_system_v6_core(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,text,uuid,integer,text[],uuid,bigint,uuid,uuid,text,uuid,uuid,uuid)'
  ));
  v_count := (length(v_definition) - length(replace(v_definition, v_old, '')))
    / length(v_old);
  if v_count is distinct from 1 then
    raise exception 'agent_phase_c_v6_bridge_site_drifted'
      using errcode = '55000';
  end if;
  execute replace(v_definition, v_old, v_new);
end;
$function$;

select pg_temp.agent_bridge_phase_c_v6_core();
drop function pg_temp.agent_bridge_phase_c_v6_core();

create or replace function public.read_agent_job_communication_context_as_system(
  p_request_id text,
  p_actor_user_id uuid,
  p_company_id uuid,
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_capability_id text,
  p_capability_revision text,
  p_capability_manifest_revision text,
  p_required_oauth_scopes text[],
  p_inbox_scope text,
  p_clients_scope text,
  p_job_permission text,
  p_job_scope text,
  p_projects_scope text,
  p_calendar_scope text,
  p_tasks_scope text,
  p_photos_scope text,
  p_job_kind text,
  p_job_id uuid,
  p_purpose text
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_v6_result jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_capability_manifest_revision is null
     or p_capability_manifest_revision not in (
       '2026-08-14.capability-manifest.v6',
       '2026-08-20.capability-manifest.v7'
     ) then
    raise exception 'invalid_agent_job_communication_context_request'
      using errcode = '22023';
  end if;
  v_v6_result :=
    private.read_agent_job_communication_context_as_system_v6_core(
      p_request_id,
      p_actor_user_id,
      p_company_id,
      p_permission_snapshot_revision,
      p_registered_permission_keys,
      p_capability_id,
      p_capability_revision,
      '2026-08-14.capability-manifest.v6',
      p_required_oauth_scopes,
      p_inbox_scope,
      p_clients_scope,
      p_job_permission,
      p_job_scope,
      p_projects_scope,
      p_calendar_scope,
      p_tasks_scope,
      p_photos_scope,
      p_job_kind,
      p_job_id,
      p_purpose
    );
  if p_capability_manifest_revision =
       '2026-08-14.capability-manifest.v6' then
    return v_v6_result;
  end if;
  return private.reprove_agent_read_jsonb_for_manifest(
    v_v6_result,
    '2026-08-20.capability-manifest.v7'
  );
end;
$function$;

revoke all on function public.read_agent_job_communication_context_as_system(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, text, text, text, text, text, text, uuid, text
) from public, anon, authenticated, service_role;
grant execute on function public.read_agent_job_communication_context_as_system(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, text, text, text, text, text, text, uuid, text
) to service_role;

create or replace function public.read_agent_job_participants_as_system(
  p_request_id text,
  p_actor_user_id uuid,
  p_company_id uuid,
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_capability_id text,
  p_capability_revision text,
  p_capability_manifest_revision text,
  p_required_oauth_scopes text[],
  p_inbox_scope text,
  p_clients_scope text,
  p_job_permission text,
  p_job_scope text,
  p_projects_scope text,
  p_tasks_scope text,
  p_job_kind text,
  p_job_id uuid,
  p_purpose text
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_v6_result jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_capability_manifest_revision is null
     or p_capability_manifest_revision not in (
       '2026-08-14.capability-manifest.v6',
       '2026-08-20.capability-manifest.v7'
     ) then
    raise exception 'invalid_agent_job_participants_request'
      using errcode = '22023';
  end if;
  v_v6_result := private.read_agent_job_participants_as_system_v6_core(
      p_request_id,
      p_actor_user_id,
      p_company_id,
      p_permission_snapshot_revision,
      p_registered_permission_keys,
      p_capability_id,
      p_capability_revision,
      '2026-08-14.capability-manifest.v6',
      p_required_oauth_scopes,
      p_inbox_scope,
      p_clients_scope,
      p_job_permission,
      p_job_scope,
      p_projects_scope,
      p_tasks_scope,
      p_job_kind,
      p_job_id,
      p_purpose
    );
  if p_capability_manifest_revision =
       '2026-08-14.capability-manifest.v6' then
    return v_v6_result;
  end if;
  return private.reprove_agent_read_jsonb_for_manifest(
    v_v6_result,
    '2026-08-20.capability-manifest.v7'
  );
end;
$function$;

revoke all on function public.read_agent_job_participants_as_system(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, text, text, text, text, uuid, text
) from public, anon, authenticated, service_role;
grant execute on function public.read_agent_job_participants_as_system(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, text, text, text, text, uuid, text
) to service_role;

create or replace function public.read_agent_job_conversation_context_as_system(
  p_request_id text,
  p_actor_user_id uuid,
  p_company_id uuid,
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_capability_id text,
  p_capability_revision text,
  p_capability_manifest_revision text,
  p_required_oauth_scopes text[],
  p_inbox_scope text,
  p_clients_scope text,
  p_job_permission text,
  p_job_scope text,
  p_job_kind text,
  p_job_id uuid,
  p_exact_turn_limit integer default 20,
  p_sections text[] default array[
    'memory', 'recent_turns', 'participants', 'gaps', 'cross_job_seed'
  ]::text[],
  p_required_through_turn_id uuid default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_v6_result jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_capability_manifest_revision is null
     or p_capability_manifest_revision not in (
       '2026-08-14.capability-manifest.v6',
       '2026-08-20.capability-manifest.v7'
     ) then
    raise exception 'invalid_agent_job_conversation_context_request'
      using errcode = '22023';
  end if;
  v_v6_result :=
    private.read_agent_job_conversation_context_as_system_v6_core(
      p_request_id,
      p_actor_user_id,
      p_company_id,
      p_permission_snapshot_revision,
      p_registered_permission_keys,
      p_capability_id,
      p_capability_revision,
      '2026-08-14.capability-manifest.v6',
      p_required_oauth_scopes,
      p_inbox_scope,
      p_clients_scope,
      p_job_permission,
      p_job_scope,
      p_job_kind,
      p_job_id,
      p_exact_turn_limit,
      p_sections,
      p_required_through_turn_id
    );
  if p_capability_manifest_revision =
       '2026-08-14.capability-manifest.v6' then
    return v_v6_result;
  end if;
  return private.reprove_agent_read_jsonb_for_manifest(
    v_v6_result,
    '2026-08-20.capability-manifest.v7'
  );
end;
$function$;

revoke all on function public.read_agent_job_conversation_context_as_system(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, text, text, uuid, integer, text[], uuid
) from public, anon, authenticated, service_role;
grant execute on function public.read_agent_job_conversation_context_as_system(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, text, text, uuid, integer, text[], uuid
) to service_role;

create or replace function public.read_agent_scheduled_jobs_as_system(
  p_request_id text,
  p_actor_user_id uuid,
  p_company_id uuid,
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_capability_id text,
  p_capability_revision text,
  p_capability_manifest_revision text,
  p_required_oauth_scopes text[],
  p_calendar_scope text,
  p_projects_scope text,
  p_tasks_scope text,
  p_from timestamptz,
  p_to timestamptz,
  p_task_statuses text[],
  p_confirmation_states text[] default null,
  p_display_timezone text default null,
  p_read_as_of timestamptz default null,
  p_cursor_source_revision bigint default null,
  p_cursor_start_utc timestamptz default null,
  p_cursor_task_id uuid default null,
  p_limit integer default 25
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_v6_result jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_capability_manifest_revision is null
     or p_capability_manifest_revision not in (
       '2026-08-14.capability-manifest.v6',
       '2026-08-20.capability-manifest.v7'
     ) then
    raise exception 'invalid_agent_scheduled_jobs_request'
      using errcode = '22023';
  end if;
  v_v6_result := private.read_agent_scheduled_jobs_as_system_v6_core(
      p_request_id,
      p_actor_user_id,
      p_company_id,
      p_permission_snapshot_revision,
      p_registered_permission_keys,
      p_capability_id,
      p_capability_revision,
      '2026-08-14.capability-manifest.v6',
      p_required_oauth_scopes,
      p_calendar_scope,
      p_projects_scope,
      p_tasks_scope,
      p_from,
      p_to,
      p_task_statuses,
      p_confirmation_states,
      p_display_timezone,
      p_read_as_of,
      p_cursor_source_revision,
      p_cursor_start_utc,
      p_cursor_task_id,
      p_limit
    );
  if p_capability_manifest_revision =
       '2026-08-14.capability-manifest.v6' then
    return v_v6_result;
  end if;
  return private.reprove_agent_read_jsonb_for_manifest(
    v_v6_result,
    '2026-08-20.capability-manifest.v7'
  );
end;
$function$;

revoke all on function public.read_agent_scheduled_jobs_as_system(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, timestamptz, timestamptz, text[], text[], text, timestamptz,
  bigint, timestamptz, uuid, integer
) from public, anon, authenticated, service_role;
grant execute on function public.read_agent_scheduled_jobs_as_system(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, timestamptz, timestamptz, text[], text[], text, timestamptz,
  bigint, timestamptz, uuid, integer
) to service_role;

create or replace function public.read_agent_job_readiness_issues_as_system(
  p_request_id text,
  p_actor_user_id uuid,
  p_company_id uuid,
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_capability_id text,
  p_capability_revision text,
  p_capability_manifest_revision text,
  p_required_oauth_scopes text[],
  p_calendar_scope text,
  p_clients_scope text,
  p_photos_scope text,
  p_projects_scope text,
  p_tasks_scope text,
  p_from timestamptz,
  p_to timestamptz,
  p_rule_codes text[],
  p_read_as_of timestamptz default null,
  p_cursor_source_revision bigint default null,
  p_cursor_first_scheduled_start_utc timestamptz default null,
  p_cursor_project_id uuid default null,
  p_scan_limit integer default 50
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_v6_result jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_capability_manifest_revision is null
     or p_capability_manifest_revision not in (
       '2026-08-14.capability-manifest.v6',
       '2026-08-20.capability-manifest.v7'
     ) then
    raise exception 'invalid_agent_job_readiness_request'
      using errcode = '22023';
  end if;
  v_v6_result :=
    private.read_agent_job_readiness_issues_as_system_v6_core(
      p_request_id,
      p_actor_user_id,
      p_company_id,
      p_permission_snapshot_revision,
      p_registered_permission_keys,
      p_capability_id,
      p_capability_revision,
      '2026-08-14.capability-manifest.v6',
      p_required_oauth_scopes,
      p_calendar_scope,
      p_clients_scope,
      p_photos_scope,
      p_projects_scope,
      p_tasks_scope,
      p_from,
      p_to,
      p_rule_codes,
      p_read_as_of,
      p_cursor_source_revision,
      p_cursor_first_scheduled_start_utc,
      p_cursor_project_id,
      p_scan_limit
    );
  if p_capability_manifest_revision =
       '2026-08-14.capability-manifest.v6' then
    return v_v6_result;
  end if;
  return private.reprove_agent_read_jsonb_for_manifest(
    v_v6_result,
    '2026-08-20.capability-manifest.v7'
  );
end;
$function$;

revoke all on function public.read_agent_job_readiness_issues_as_system(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, text, text, timestamptz, timestamptz, text[], timestamptz,
  bigint, timestamptz, uuid, integer
) from public, anon, authenticated, service_role;
grant execute on function public.read_agent_job_readiness_issues_as_system(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, text, text, timestamptz, timestamptz, text[], timestamptz,
  bigint, timestamptz, uuid, integer
) to service_role;

create or replace function public.read_agent_correspondence_evidence_as_system(
  p_request_id text,
  p_actor_user_id uuid,
  p_company_id uuid,
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_capability_id text,
  p_capability_revision text,
  p_capability_manifest_revision text,
  p_required_oauth_scope text,
  p_inbox_scope text,
  p_evidence_ids text[]
) returns table (
  evidence_id text,
  company_id uuid,
  source_id text,
  occurred_at text,
  subject text,
  side text,
  participant_id text,
  participant_resolution_status text,
  direction text,
  source_activity_id uuid,
  source_correspondence_event_id uuid,
  recipient_identities text[],
  cc_recipient_identities text[],
  redaction_kinds text[],
  normalized_plain_text text,
  original_content_hash text,
  attachments jsonb
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $function$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_capability_id is distinct from 'get_correspondence_evidence'
     or p_capability_revision is distinct from
       'get_correspondence_evidence:2026-08-14.v1'
     or p_capability_manifest_revision is null
     or p_capability_manifest_revision not in (
       '2026-08-14.capability-manifest.v6',
       '2026-08-20.capability-manifest.v7'
     ) then
    raise exception 'invalid_agent_correspondence_evidence_request'
      using errcode = '22023';
  end if;
  return query
  select core.evidence_id,
         core.company_id,
         core.source_id,
         core.occurred_at,
         core.subject,
         core.side,
         core.participant_id,
         core.participant_resolution_status,
         core.direction,
         core.source_activity_id,
         core.source_correspondence_event_id,
         core.recipient_identities,
         core.cc_recipient_identities,
         core.redaction_kinds,
         core.normalized_plain_text,
         core.original_content_hash,
         core.attachments
  from private.read_agent_correspondence_evidence_as_system_v6_core(
    p_request_id,
    p_actor_user_id,
    p_company_id,
    p_permission_snapshot_revision,
    p_registered_permission_keys,
    p_capability_id,
    p_capability_revision,
    '2026-08-14.capability-manifest.v6',
    p_required_oauth_scope,
    p_inbox_scope,
    p_evidence_ids
  ) core;
end;
$function$;

revoke all on function public.read_agent_correspondence_evidence_as_system(
  text, uuid, uuid, text, text[], text, text, text, text, text, text[]
) from public, anon, authenticated, service_role;
grant execute on function public.read_agent_correspondence_evidence_as_system(
  text, uuid, uuid, text, text[], text, text, text, text, text, text[]
) to service_role;

create or replace function public.read_agent_phase_c_job_conversation_context_as_system(
  p_request_id text,
  p_actor_user_id uuid,
  p_company_id uuid,
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_capability_id text,
  p_capability_revision text,
  p_capability_manifest_revision text,
  p_required_oauth_scopes text[],
  p_inbox_scope text,
  p_clients_scope text,
  p_job_permission text,
  p_job_scope text,
  p_job_kind text,
  p_job_id uuid,
  p_exact_turn_limit integer,
  p_sections text[],
  p_required_through_turn_id uuid,
  p_phase_c_assignment_version bigint,
  p_phase_c_connection_id uuid,
  p_phase_c_internal_thread_id uuid,
  p_phase_c_provider_thread_id text,
  p_phase_c_source_activity_id uuid,
  p_phase_c_source_turn_id uuid,
  p_phase_c_source_conversation_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_v6_result jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_capability_manifest_revision is null
     or p_capability_manifest_revision not in (
       '2026-08-14.capability-manifest.v6',
       '2026-08-20.capability-manifest.v7'
     ) then
    raise exception 'invalid_agent_job_conversation_context_request'
      using errcode = '22023';
  end if;
  v_v6_result :=
    private.read_agent_phase_c_job_conversation_context_as_system_v6_core(
      p_request_id,
      p_actor_user_id,
      p_company_id,
      p_permission_snapshot_revision,
      p_registered_permission_keys,
      p_capability_id,
      p_capability_revision,
      '2026-08-14.capability-manifest.v6',
      p_required_oauth_scopes,
      p_inbox_scope,
      p_clients_scope,
      p_job_permission,
      p_job_scope,
      p_job_kind,
      p_job_id,
      p_exact_turn_limit,
      p_sections,
      p_required_through_turn_id,
      p_phase_c_assignment_version,
      p_phase_c_connection_id,
      p_phase_c_internal_thread_id,
      p_phase_c_provider_thread_id,
      p_phase_c_source_activity_id,
      p_phase_c_source_turn_id,
      p_phase_c_source_conversation_id
    );
  if p_capability_manifest_revision =
       '2026-08-14.capability-manifest.v6' then
    return v_v6_result;
  end if;
  return private.reprove_agent_read_jsonb_for_manifest(
    v_v6_result,
    '2026-08-20.capability-manifest.v7'
  );
end;
$function$;

revoke all on function public.read_agent_phase_c_job_conversation_context_as_system(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, text, text, uuid, integer, text[], uuid, bigint, uuid, uuid, text,
  uuid, uuid, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.read_agent_phase_c_job_conversation_context_as_system(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, text, text, uuid, integer, text[], uuid, bigint, uuid, uuid, text,
  uuid, uuid, uuid
) to service_role;

create or replace function public.read_agent_customer_jobs_as_system(
  p_request_id text,
  p_actor_user_id uuid,
  p_company_id uuid,
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_capability_id text,
  p_capability_revision text,
  p_capability_manifest_revision text,
  p_required_oauth_scopes text[],
  p_clients_scope text,
  p_pipeline_scope text,
  p_projects_scope text,
  p_customer_kind text,
  p_customer_id uuid,
  p_job_kinds text[],
  p_lifecycle_states text[],
  p_opportunity_stages text[],
  p_project_statuses text[],
  p_date_field text,
  p_date_from timestamptz,
  p_date_to_exclusive timestamptz,
  p_read_as_of timestamptz,
  p_cursor_source_revision bigint,
  p_cursor_sort_at timestamptz,
  p_cursor_job_kind text,
  p_cursor_job_id uuid,
  p_limit integer
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_v6_result jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_capability_manifest_revision is null
     or p_capability_manifest_revision not in (
       '2026-08-14.capability-manifest.v6',
       '2026-08-20.capability-manifest.v7'
     ) then
    raise exception 'invalid_agent_customer_jobs_request'
      using errcode = '22023';
  end if;
  v_v6_result := private.read_agent_customer_jobs_as_system_v6_core(
      p_request_id,
      p_actor_user_id,
      p_company_id,
      p_permission_snapshot_revision,
      p_registered_permission_keys,
      p_capability_id,
      p_capability_revision,
      '2026-08-14.capability-manifest.v6',
      p_required_oauth_scopes,
      p_clients_scope,
      p_pipeline_scope,
      p_projects_scope,
      p_customer_kind,
      p_customer_id,
      p_job_kinds,
      p_lifecycle_states,
      p_opportunity_stages,
      p_project_statuses,
      p_date_field,
      p_date_from,
      p_date_to_exclusive,
      p_read_as_of,
      p_cursor_source_revision,
      p_cursor_sort_at,
      p_cursor_job_kind,
      p_cursor_job_id,
      p_limit
    );
  if p_capability_manifest_revision =
       '2026-08-14.capability-manifest.v6' then
    return v_v6_result;
  end if;
  return private.reprove_agent_read_jsonb_for_manifest(
    v_v6_result,
    '2026-08-20.capability-manifest.v7'
  );
end;
$function$;

revoke all on function public.read_agent_customer_jobs_as_system(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text, text,
  text, uuid, text[], text[], text[], text[], text, timestamptz, timestamptz,
  timestamptz, bigint, timestamptz, text, uuid, integer
) from public, anon, authenticated, service_role;
grant execute on function public.read_agent_customer_jobs_as_system(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text, text,
  text, uuid, text[], text[], text[], text[], text, timestamptz, timestamptz,
  timestamptz, bigint, timestamptz, text, uuid, integer
) to service_role;

create or replace function public.read_agent_job_summary_as_system(
  p_request_id text,
  p_actor_user_id uuid,
  p_company_id uuid,
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_capability_id text,
  p_capability_revision text,
  p_capability_manifest_revision text,
  p_required_oauth_scopes text[],
  p_inbox_scope text,
  p_clients_scope text,
  p_pipeline_scope text,
  p_projects_scope text,
  p_calendar_scope text,
  p_tasks_scope text,
  p_photos_scope text,
  p_estimates_scope text,
  p_invoices_scope text,
  p_projects_financials_scope text,
  p_job_kind text,
  p_job_id uuid,
  p_sections text[],
  p_readiness_rule_codes text[],
  p_financial_components text[]
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_v6_result jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_capability_manifest_revision is null
     or p_capability_manifest_revision not in (
       '2026-08-14.capability-manifest.v6',
       '2026-08-20.capability-manifest.v7'
     ) then
    raise exception 'invalid_agent_job_summary_request'
      using errcode = '22023';
  end if;
  v_v6_result := private.read_agent_job_summary_as_system_v6_core(
      p_request_id,
      p_actor_user_id,
      p_company_id,
      p_permission_snapshot_revision,
      p_registered_permission_keys,
      p_capability_id,
      p_capability_revision,
      '2026-08-14.capability-manifest.v6',
      p_required_oauth_scopes,
      p_inbox_scope,
      p_clients_scope,
      p_pipeline_scope,
      p_projects_scope,
      p_calendar_scope,
      p_tasks_scope,
      p_photos_scope,
      p_estimates_scope,
      p_invoices_scope,
      p_projects_financials_scope,
      p_job_kind,
      p_job_id,
      p_sections,
      p_readiness_rule_codes,
      p_financial_components
    );
  if p_capability_manifest_revision =
       '2026-08-14.capability-manifest.v6' then
    return v_v6_result;
  end if;
  return private.reprove_agent_read_jsonb_for_manifest(
    v_v6_result,
    '2026-08-20.capability-manifest.v7'
  );
end;
$function$;

revoke all on function public.read_agent_job_summary_as_system(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text, text,
  text, text, text, text, text, text, text, text, uuid, text[], text[], text[]
) from public, anon, authenticated, service_role;
grant execute on function public.read_agent_job_summary_as_system(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text, text,
  text, text, text, text, text, text, text, text, uuid, text[], text[], text[]
) to service_role;

create or replace function public.read_agent_correspondence_evidence_page_as_system(
  p_request_id text,
  p_actor_user_id uuid,
  p_company_id uuid,
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_capability_id text,
  p_capability_revision text,
  p_capability_manifest_revision text,
  p_required_oauth_scopes text[],
  p_inbox_scope text,
  p_pipeline_scope text,
  p_projects_scope text,
  p_job_kind text,
  p_job_id uuid,
  p_evidence_ids text[],
  p_mode text
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_v6_result jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_capability_manifest_revision is null
     or p_capability_manifest_revision not in (
       '2026-08-14.capability-manifest.v6',
       '2026-08-20.capability-manifest.v7'
     ) then
    raise exception 'invalid_agent_correspondence_evidence_request'
      using errcode = '22023';
  end if;
  v_v6_result :=
    private.read_agent_correspondence_evidence_page_as_system_v6_core(
      p_request_id,
      p_actor_user_id,
      p_company_id,
      p_permission_snapshot_revision,
      p_registered_permission_keys,
      p_capability_id,
      p_capability_revision,
      '2026-08-14.capability-manifest.v6',
      p_required_oauth_scopes,
      p_inbox_scope,
      p_pipeline_scope,
      p_projects_scope,
      p_job_kind,
      p_job_id,
      p_evidence_ids,
      p_mode
    );
  if p_capability_manifest_revision =
       '2026-08-14.capability-manifest.v6' then
    return v_v6_result;
  end if;
  return private.reprove_agent_read_jsonb_for_manifest(
    v_v6_result,
    '2026-08-20.capability-manifest.v7'
  );
end;
$function$;

revoke all on function public.read_agent_correspondence_evidence_page_as_system(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text, text,
  text, uuid, text[], text
) from public, anon, authenticated, service_role;
grant execute on function public.read_agent_correspondence_evidence_page_as_system(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text, text,
  text, uuid, text[], text
) to service_role;

create or replace function public.read_agent_job_history_as_system(
  p_request_id text,
  p_actor_user_id uuid,
  p_company_id uuid,
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_capability_id text,
  p_capability_revision text,
  p_capability_manifest_revision text,
  p_required_oauth_scopes text[],
  p_inbox_scope text,
  p_clients_scope text,
  p_pipeline_scope text,
  p_projects_scope text,
  p_calendar_scope text,
  p_tasks_scope text,
  p_estimates_scope text,
  p_projects_financials_scope text,
  p_query text,
  p_scope_kind text,
  p_customer_kind text,
  p_customer_id uuid,
  p_scope_job_kinds text[],
  p_job_refs jsonb,
  p_from timestamptz,
  p_to_exclusive timestamptz,
  p_source_types text[],
  p_read_as_of timestamptz,
  p_cursor_source_revision bigint,
  p_cursor_history_revision bigint,
  p_cursor_rank_micros bigint,
  p_cursor_occurred_at timestamptz,
  p_cursor_source_type text,
  p_cursor_source_id text,
  p_limit integer
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_v6_result jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_capability_manifest_revision is null
     or p_capability_manifest_revision not in (
       '2026-08-14.capability-manifest.v6',
       '2026-08-20.capability-manifest.v7'
     ) then
    raise exception 'invalid_agent_job_history_request'
      using errcode = '22023';
  end if;
  v_v6_result := private.read_agent_job_history_as_system_v6_core(
      p_request_id,
      p_actor_user_id,
      p_company_id,
      p_permission_snapshot_revision,
      p_registered_permission_keys,
      p_capability_id,
      p_capability_revision,
      '2026-08-14.capability-manifest.v6',
      p_required_oauth_scopes,
      p_inbox_scope,
      p_clients_scope,
      p_pipeline_scope,
      p_projects_scope,
      p_calendar_scope,
      p_tasks_scope,
      p_estimates_scope,
      p_projects_financials_scope,
      p_query,
      p_scope_kind,
      p_customer_kind,
      p_customer_id,
      p_scope_job_kinds,
      p_job_refs,
      p_from,
      p_to_exclusive,
      p_source_types,
      p_read_as_of,
      p_cursor_source_revision,
      p_cursor_history_revision,
      p_cursor_rank_micros,
      p_cursor_occurred_at,
      p_cursor_source_type,
      p_cursor_source_id,
      p_limit
    );
  if p_capability_manifest_revision =
       '2026-08-14.capability-manifest.v6' then
    return v_v6_result;
  end if;
  return private.reprove_agent_read_jsonb_for_manifest(
    v_v6_result,
    '2026-08-20.capability-manifest.v7'
  );
end;
$function$;

revoke all on function public.read_agent_job_history_as_system(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text, text,
  text, text, text, text, text, text, text, text, uuid, text[], jsonb,
  timestamptz, timestamptz, text[], timestamptz, bigint, bigint, bigint,
  timestamptz, text, text, integer
) from public, anon, authenticated, service_role;
grant execute on function public.read_agent_job_history_as_system(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text, text,
  text, text, text, text, text, text, text, text, uuid, text[], jsonb,
  timestamptz, timestamptz, text[], timestamptz, bigint, bigint, bigint,
  timestamptz, text, text, integer
) to service_role;

create or replace function public.read_agent_customer_discovery_as_system(
  p_request_id text,
  p_actor_user_id uuid,
  p_company_id uuid,
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_capability_id text,
  p_capability_revision text,
  p_capability_manifest_revision text,
  p_capability_schema_revision text,
  p_ranking_revision text,
  p_required_oauth_scopes text[],
  p_clients_scope text,
  p_lookup text,
  p_query text,
  p_customer_kinds text[],
  p_read_as_of timestamptz,
  p_cursor_source_revision bigint,
  p_cursor_rank_ordinal integer,
  p_cursor_customer_kind text,
  p_cursor_customer_id uuid,
  p_limit integer
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private, extensions, pg_temp
set plan_cache_mode = force_custom_plan
as $function$
declare
  v_expected_oauth_scopes text[];
  v_read_as_of timestamptz;
  v_result jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_request_id is null
     or p_request_id is distinct from btrim(p_request_id)
     or octet_length(p_request_id) not between 1 and 256
     or p_actor_user_id is null
     or p_company_id is null
     or p_permission_snapshot_revision is null
     or p_permission_snapshot_revision !~ '^sha256:[0-9a-f]{64}$'
     or p_registered_permission_keys is null
     or p_capability_id is distinct from 'search_customers'
     or p_capability_revision is distinct from
       'search_customers:2026-08-20.v1'
     or p_capability_manifest_revision is distinct from
       '2026-08-20.capability-manifest.v7'
     or p_capability_schema_revision is distinct from '2026-08-20.v1'
     or p_ranking_revision is distinct from
       'customer-discovery-ranking:v1'
     or p_clients_scope is null
     or p_clients_scope not in ('all', 'assigned')
     or p_lookup is null
     or p_lookup not in ('name', 'exact_email', 'exact_phone')
     or p_lookup = 'name' and
       private.agent_discovery_query_is_valid(p_query) is not true
     or p_lookup = 'exact_email' and (
       private.agent_normalize_discovery_email(p_query) is null
       or p_query is distinct from
         private.agent_normalize_discovery_email(p_query)
     )
     or p_lookup = 'exact_phone' and (
       private.agent_normalize_discovery_phone(p_query) is null
       or p_query is distinct from
         private.agent_normalize_discovery_phone(p_query)
     )
     or p_customer_kinds is null
     or cardinality(p_customer_kinds) not between 1 and 2
     or p_customer_kinds <@ array['client', 'sub_client']::text[] is not true
     or (select count(distinct requested.kind)
         from unnest(p_customer_kinds) requested(kind)) <>
       cardinality(p_customer_kinds)
     or p_limit is null
     or p_limit not between 1 and 25
     or p_read_as_of is not null and not isfinite(p_read_as_of)
     or p_read_as_of is not null and extract(
       year from p_read_as_of at time zone 'UTC'
     ) not between 1 and 9999
     or p_read_as_of is not null and p_read_as_of is distinct from
       date_trunc('milliseconds', p_read_as_of, 'UTC')
     or (p_read_as_of is null) is distinct from
       (p_cursor_source_revision is null)
     or (p_cursor_source_revision is null) is distinct from
       (p_cursor_rank_ordinal is null)
     or (p_cursor_source_revision is null) is distinct from
       (p_cursor_customer_kind is null)
     or (p_cursor_source_revision is null) is distinct from
       (p_cursor_customer_id is null)
     or p_cursor_source_revision is not null and
       p_cursor_source_revision not between 0 and 9007199254740991
     or p_cursor_rank_ordinal is not null and
       p_cursor_rank_ordinal not between 1 and 500
     or p_cursor_customer_kind is not null and
       p_cursor_customer_kind not in ('client', 'sub_client') then
    raise exception 'invalid_agent_customer_discovery_request'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from unnest(p_registered_permission_keys) registry(permission_key)
    where registry.permission_key is null
       or registry.permission_key is distinct from btrim(registry.permission_key)
       or octet_length(registry.permission_key) not between 1 and 128
  ) or (
    select count(distinct registry.permission_key)
    from unnest(p_registered_permission_keys) registry(permission_key)
  ) <> cardinality(p_registered_permission_keys)
  or not ('clients.view' = any(p_registered_permission_keys)) then
    raise exception 'invalid_agent_customer_discovery_request'
      using errcode = '22023';
  end if;

  select array_agg(requested.scope order by requested.scope)
  into v_expected_oauth_scopes
  from (
    select 'ops.customers.read'::text as scope
    union all
    select 'ops.customer_contacts.read'::text
    where p_lookup in ('exact_email', 'exact_phone')
  ) requested;
  if p_required_oauth_scopes is distinct from v_expected_oauth_scopes then
    raise exception 'invalid_agent_customer_discovery_request'
      using errcode = '22023';
  end if;

  v_read_as_of := date_trunc(
    'milliseconds', coalesce(p_read_as_of, statement_timestamp())
  );

  with current_authority as materialized (
    select authority.permission_snapshot_revision,
           max(permission.value ->> 'scope') filter (
             where permission.value ->> 'permission' = 'clients.view'
           ) as clients_scope
    from private.resolve_agent_actor_authority(
      p_actor_user_id,
      p_company_id,
      p_registered_permission_keys
    ) authority
    cross join lateral jsonb_array_elements(
      authority.effective_permissions
    ) permission(value)
    group by authority.permission_snapshot_revision
  ), authority_context as materialized (
    select authority.permission_snapshot_revision,
           revision.source_revision,
           date_trunc('milliseconds', statement_timestamp()) as statement_read_at
    from current_authority authority
    join public.companies company
      on company.id = p_company_id
     and company.deleted_at is null
    join private.agent_operational_read_revisions revision
      on revision.company_id = p_company_id
     and revision.source_revision between 0 and 9007199254740991
    where authority.permission_snapshot_revision =
            p_permission_snapshot_revision
      and authority.clients_scope = p_clients_scope
      and (p_cursor_source_revision is null
        or revision.source_revision = p_cursor_source_revision)
      and v_read_as_of <=
        date_trunc('milliseconds', statement_timestamp())
  ), query_tokens as materialized (
    select regexp_split_to_array(p_query, ' ') as values
    where p_lookup = 'name'
  ), client_base_source as not materialized (
    select 'client'::text as customer_kind,
           client.id as customer_id,
           client.name as display_name,
           null::uuid as parent_client_id,
           null::text as parent_display_name,
           normalized.name as normalized_name,
           private.agent_normalize_discovery_email(client.email)
             as normalized_email,
           private.agent_normalize_discovery_phone(client.phone_number)
             as normalized_phone,
           nullif(private.agent_trim_discovery_display_text(client.name), '')
             is null
           or octet_length(
             private.agent_trim_discovery_display_text(client.name)
           ) > 1000
             or normalized.name is null as source_data_invalid
    from authority_context context
    join public.clients client
      on client.company_id = p_company_id
     and client.deleted_at is null
     and client.merged_into_client_id is null
    cross join lateral (
      select private.agent_normalize_discovery_text(client.name)
               collate "C" as name
    ) normalized
    where 'client' = any(p_customer_kinds)
  ), sub_client_base_source as not materialized (
    select 'sub_client'::text as customer_kind,
           sub_client.id as customer_id,
           sub_client.name as display_name,
           parent.id as parent_client_id,
           parent.name as parent_display_name,
           normalized.name as normalized_name,
           private.agent_normalize_discovery_email(sub_client.email)
             as normalized_email,
           private.agent_normalize_discovery_phone(sub_client.phone_number)
             as normalized_phone,
           nullif(private.agent_trim_discovery_display_text(sub_client.name), '')
             is null
           or octet_length(
             private.agent_trim_discovery_display_text(sub_client.name)
           ) > 1000
           or normalized.name is null
           or nullif(
             private.agent_trim_discovery_display_text(parent.name), ''
           ) is null
             or octet_length(
               private.agent_trim_discovery_display_text(parent.name)
             ) > 1000
             or normalized.parent_name is null as source_data_invalid
    from authority_context context
    join public.sub_clients sub_client
      on sub_client.company_id = p_company_id
     and sub_client.deleted_at is null
    join public.clients parent
      on parent.id = sub_client.client_id
     and parent.company_id = p_company_id
     and parent.deleted_at is null
     and parent.merged_into_client_id is null
    cross join lateral (
      select private.agent_normalize_discovery_text(sub_client.name)
               collate "C" as name,
             private.agent_normalize_discovery_text(
               parent.name
             ) collate "C" as parent_name
    ) normalized
    where 'sub_client' = any(p_customer_kinds)
  ), client_inspection_source as not materialized (
    select candidate.*
    from client_base_source candidate
  ), sub_client_inspection_source as not materialized (
    select candidate.*
    from sub_client_base_source candidate
  ), client_name_literal_keyset as materialized (
    select client.id as customer_id
    from authority_context context
    join public.clients client
      on client.company_id = p_company_id
     and client.deleted_at is null
     and client.merged_into_client_id is null
    where p_lookup = 'name'
      and 'client' = any(p_customer_kinds)
      and left(
        private.agent_normalize_discovery_text(client.name), 200
      ) collate "C" >= p_query collate "C"
      and left(
        private.agent_normalize_discovery_text(client.name), 200
      ) collate "C" <
        private.agent_discovery_prefix_upper_bound(p_query) collate "C"
    order by left(
        private.agent_normalize_discovery_text(client.name), 200
      ) collate "C",
      client.id
    limit 501
  ), client_name_literal_keyset_bound as materialized (
    select count(*) = 501 as query_bound
    from client_name_literal_keyset
  ), client_name_exact_gate as materialized (
    select candidate.*, 'exact_name'::text as match_kind,
           1::integer as match_tier
    from client_name_literal_keyset_bound bound
    join client_name_literal_keyset keyset on not bound.query_bound
    cross join lateral (
      select source_candidate.*
      from client_inspection_source source_candidate
      where source_candidate.customer_id = keyset.customer_id
      limit 1
    ) candidate
    where p_lookup = 'name'
      and candidate.normalized_name = p_query
      and left(candidate.normalized_name, 200) = p_query
    order by left(candidate.normalized_name, 200) collate "C",
      candidate.customer_id
    limit 501
  ), client_name_prefix_gate as materialized (
    select candidate.*, 'prefix_name'::text as match_kind,
           2::integer as match_tier
    from client_name_literal_keyset_bound bound
    join client_name_literal_keyset keyset on not bound.query_bound
    cross join lateral (
      select source_candidate.*
      from client_inspection_source source_candidate
      where source_candidate.customer_id = keyset.customer_id
      limit 1
    ) candidate
    where p_lookup = 'name'
      and candidate.normalized_name is distinct from p_query
      and candidate.normalized_name like
        private.agent_escape_like_literal(p_query) || '%' escape '\'
      and left(candidate.normalized_name, 200) like
        private.agent_escape_like_literal(p_query) || '%' escape '\'
    order by left(candidate.normalized_name, 200) collate "C",
      candidate.customer_id
    limit 501
  ), client_name_all_tokens_gate as materialized (
    select candidate.*, 'all_tokens_name'::text as match_kind,
           3::integer as match_tier
    from query_tokens tokens
    cross join client_inspection_source candidate
    where not (select query_bound from client_name_literal_keyset_bound)
      and (select count(*) from client_name_exact_gate) +
        (select count(*) from client_name_prefix_gate) < 501
      and not exists (
      select 1 from unnest(tokens.values) short_token(value)
      where char_length(short_token.value) < 3
    )
      and candidate.normalized_name is distinct from p_query
      and candidate.normalized_name not like
        private.agent_escape_like_literal(p_query) || '%' escape '\'
      and candidate.normalized_name like '%' || private.agent_escape_like_literal(
        tokens.values[1]
      ) || '%' escape '\'
      and candidate.normalized_name like '%' || private.agent_escape_like_literal(
        coalesce(tokens.values[2], tokens.values[1])
      ) || '%' escape '\'
      and candidate.normalized_name like '%' || private.agent_escape_like_literal(
        coalesce(tokens.values[3], tokens.values[1])
      ) || '%' escape '\'
      and candidate.normalized_name like '%' || private.agent_escape_like_literal(
        coalesce(tokens.values[4], tokens.values[1])
      ) || '%' escape '\'
      and candidate.normalized_name like '%' || private.agent_escape_like_literal(
        coalesce(tokens.values[5], tokens.values[1])
      ) || '%' escape '\'
      and candidate.normalized_name like '%' || private.agent_escape_like_literal(
        coalesce(tokens.values[6], tokens.values[1])
      ) || '%' escape '\'
      and candidate.normalized_name like '%' || private.agent_escape_like_literal(
        coalesce(tokens.values[7], tokens.values[1])
      ) || '%' escape '\'
      and candidate.normalized_name like '%' || private.agent_escape_like_literal(
        coalesce(tokens.values[8], tokens.values[1])
      ) || '%' escape '\'
    order by candidate.normalized_name collate "C",
      candidate.customer_id
    limit 501
  ), client_email_keyset as materialized (
    select client.id as customer_id
    from authority_context context
    join public.clients client
      on client.company_id = p_company_id
     and client.deleted_at is null
     and client.merged_into_client_id is null
    where p_lookup = 'exact_email'
      and 'client' = any(p_customer_kinds)
      and private.agent_normalize_discovery_email(client.email) = p_query
    order by left(
        private.agent_normalize_discovery_text(client.name), 200
      ) collate "C",
      client.id
    limit 501
  ), client_email_keyset_bound as materialized (
    select count(*) = 501 as query_bound
    from client_email_keyset
  ), client_email_gate as materialized (
    select candidate.*, 'exact_email'::text as match_kind,
           1::integer as match_tier
    from client_email_keyset_bound bound
    join client_email_keyset keyset on not bound.query_bound
    cross join lateral (
      select source_candidate.*
      from client_inspection_source source_candidate
      where source_candidate.customer_id = keyset.customer_id
      limit 1
    ) candidate
    order by left(candidate.normalized_name, 200) collate "C",
      candidate.customer_id
    limit 501
  ), client_phone_keyset as materialized (
    select client.id as customer_id
    from authority_context context
    join public.clients client
      on client.company_id = p_company_id
     and client.deleted_at is null
     and client.merged_into_client_id is null
    where p_lookup = 'exact_phone'
      and 'client' = any(p_customer_kinds)
      and private.agent_normalize_discovery_phone(client.phone_number) = p_query
    order by left(
        private.agent_normalize_discovery_text(client.name), 200
      ) collate "C",
      client.id
    limit 501
  ), client_phone_keyset_bound as materialized (
    select count(*) = 501 as query_bound
    from client_phone_keyset
  ), client_phone_gate as materialized (
    select candidate.*, 'exact_phone'::text as match_kind,
           1::integer as match_tier
    from client_phone_keyset_bound bound
    join client_phone_keyset keyset on not bound.query_bound
    cross join lateral (
      select source_candidate.*
      from client_inspection_source source_candidate
      where source_candidate.customer_id = keyset.customer_id
      limit 1
    ) candidate
    order by left(candidate.normalized_name, 200) collate "C",
      candidate.customer_id
    limit 501
  ), client_match_candidate as not materialized (
    select candidate.* from client_name_exact_gate candidate
    union all
    select candidate.* from client_name_prefix_gate candidate
    union all
    select candidate.* from client_name_all_tokens_gate candidate
    union all
    select candidate.* from client_email_gate candidate
    union all
    select candidate.* from client_phone_gate candidate
  ), client_gate as materialized (
    select candidate.*
    from client_match_candidate candidate
    order by candidate.match_tier,
      candidate.customer_kind,
      candidate.normalized_name collate "C",
      candidate.customer_id
    limit 501
  ), sub_client_name_literal_keyset as materialized (
    select sub_client.id as customer_id
    from authority_context context
    join public.sub_clients sub_client
      on sub_client.company_id = p_company_id
     and sub_client.deleted_at is null
    where p_lookup = 'name'
      and 'sub_client' = any(p_customer_kinds)
      and left(
        private.agent_normalize_discovery_text(sub_client.name), 200
      ) collate "C" >= p_query collate "C"
      and left(
        private.agent_normalize_discovery_text(sub_client.name), 200
      ) collate "C" <
        private.agent_discovery_prefix_upper_bound(p_query) collate "C"
    order by left(
        private.agent_normalize_discovery_text(sub_client.name), 200
      ) collate "C",
      sub_client.id
    limit 501
  ), sub_client_name_literal_keyset_bound as materialized (
    select count(*) = 501 as query_bound
    from sub_client_name_literal_keyset
  ), sub_client_name_exact_gate as materialized (
    select candidate.*, 'exact_name'::text as match_kind,
           1::integer as match_tier
    from sub_client_name_literal_keyset_bound bound
    join sub_client_name_literal_keyset keyset on not bound.query_bound
    cross join lateral (
      select source_candidate.*
      from sub_client_inspection_source source_candidate
      where source_candidate.customer_id = keyset.customer_id
      limit 1
    ) candidate
    where p_lookup = 'name'
      and candidate.normalized_name = p_query
      and left(candidate.normalized_name, 200) = p_query
    order by left(candidate.normalized_name, 200) collate "C",
      candidate.customer_id
    limit 501
  ), sub_client_name_prefix_gate as materialized (
    select candidate.*, 'prefix_name'::text as match_kind,
           2::integer as match_tier
    from sub_client_name_literal_keyset_bound bound
    join sub_client_name_literal_keyset keyset on not bound.query_bound
    cross join lateral (
      select source_candidate.*
      from sub_client_inspection_source source_candidate
      where source_candidate.customer_id = keyset.customer_id
      limit 1
    ) candidate
    where p_lookup = 'name'
      and candidate.normalized_name is distinct from p_query
      and candidate.normalized_name like
        private.agent_escape_like_literal(p_query) || '%' escape '\'
      and left(candidate.normalized_name, 200) like
        private.agent_escape_like_literal(p_query) || '%' escape '\'
    order by left(candidate.normalized_name, 200) collate "C",
      candidate.customer_id
    limit 501
  ), sub_client_name_all_tokens_gate as materialized (
    select candidate.*, 'all_tokens_name'::text as match_kind,
           3::integer as match_tier
    from query_tokens tokens
    cross join sub_client_inspection_source candidate
    where not (
        select query_bound from sub_client_name_literal_keyset_bound
      )
      and (select count(*) from sub_client_name_exact_gate) +
        (select count(*) from sub_client_name_prefix_gate) < 501
      and not exists (
      select 1 from unnest(tokens.values) short_token(value)
      where char_length(short_token.value) < 3
    )
      and candidate.normalized_name is distinct from p_query
      and candidate.normalized_name not like
        private.agent_escape_like_literal(p_query) || '%' escape '\'
      and candidate.normalized_name like '%' || private.agent_escape_like_literal(
        tokens.values[1]
      ) || '%' escape '\'
      and candidate.normalized_name like '%' || private.agent_escape_like_literal(
        coalesce(tokens.values[2], tokens.values[1])
      ) || '%' escape '\'
      and candidate.normalized_name like '%' || private.agent_escape_like_literal(
        coalesce(tokens.values[3], tokens.values[1])
      ) || '%' escape '\'
      and candidate.normalized_name like '%' || private.agent_escape_like_literal(
        coalesce(tokens.values[4], tokens.values[1])
      ) || '%' escape '\'
      and candidate.normalized_name like '%' || private.agent_escape_like_literal(
        coalesce(tokens.values[5], tokens.values[1])
      ) || '%' escape '\'
      and candidate.normalized_name like '%' || private.agent_escape_like_literal(
        coalesce(tokens.values[6], tokens.values[1])
      ) || '%' escape '\'
      and candidate.normalized_name like '%' || private.agent_escape_like_literal(
        coalesce(tokens.values[7], tokens.values[1])
      ) || '%' escape '\'
      and candidate.normalized_name like '%' || private.agent_escape_like_literal(
        coalesce(tokens.values[8], tokens.values[1])
      ) || '%' escape '\'
    order by candidate.normalized_name collate "C",
      candidate.customer_id
    limit 501
  ), sub_client_email_keyset as materialized (
    select sub_client.id as customer_id
    from authority_context context
    join public.sub_clients sub_client
      on sub_client.company_id = p_company_id
     and sub_client.deleted_at is null
    where p_lookup = 'exact_email'
      and 'sub_client' = any(p_customer_kinds)
      and private.agent_normalize_discovery_email(sub_client.email) = p_query
    order by left(
        private.agent_normalize_discovery_text(sub_client.name), 200
      ) collate "C",
      sub_client.id
    limit 501
  ), sub_client_email_keyset_bound as materialized (
    select count(*) = 501 as query_bound
    from sub_client_email_keyset
  ), sub_client_email_gate as materialized (
    select candidate.*, 'exact_email'::text as match_kind,
           1::integer as match_tier
    from sub_client_email_keyset_bound bound
    join sub_client_email_keyset keyset on not bound.query_bound
    cross join lateral (
      select source_candidate.*
      from sub_client_inspection_source source_candidate
      where source_candidate.customer_id = keyset.customer_id
      limit 1
    ) candidate
    order by left(candidate.normalized_name, 200) collate "C",
      candidate.customer_id
    limit 501
  ), sub_client_phone_keyset as materialized (
    select sub_client.id as customer_id
    from authority_context context
    join public.sub_clients sub_client
      on sub_client.company_id = p_company_id
     and sub_client.deleted_at is null
    where p_lookup = 'exact_phone'
      and 'sub_client' = any(p_customer_kinds)
      and private.agent_normalize_discovery_phone(sub_client.phone_number) =
        p_query
    order by left(
        private.agent_normalize_discovery_text(sub_client.name), 200
      ) collate "C",
      sub_client.id
    limit 501
  ), sub_client_phone_keyset_bound as materialized (
    select count(*) = 501 as query_bound
    from sub_client_phone_keyset
  ), sub_client_phone_gate as materialized (
    select candidate.*, 'exact_phone'::text as match_kind,
           1::integer as match_tier
    from sub_client_phone_keyset_bound bound
    join sub_client_phone_keyset keyset on not bound.query_bound
    cross join lateral (
      select source_candidate.*
      from sub_client_inspection_source source_candidate
      where source_candidate.customer_id = keyset.customer_id
      limit 1
    ) candidate
    order by left(candidate.normalized_name, 200) collate "C",
      candidate.customer_id
    limit 501
  ), sub_client_match_candidate as not materialized (
    select candidate.* from sub_client_name_exact_gate candidate
    union all
    select candidate.* from sub_client_name_prefix_gate candidate
    union all
    select candidate.* from sub_client_name_all_tokens_gate candidate
    union all
    select candidate.* from sub_client_email_gate candidate
    union all
    select candidate.* from sub_client_phone_gate candidate
  ), sub_client_gate as materialized (
    select candidate.*
    from sub_client_match_candidate candidate
    order by candidate.match_tier,
      candidate.customer_kind,
      candidate.normalized_name collate "C",
      candidate.customer_id
    limit 501
  ), inspection_candidate as (
    select client.customer_kind,
           client.customer_id,
           client.display_name,
           client.parent_client_id,
           client.parent_display_name,
           client.normalized_name,
           client.match_kind,
           client.match_tier,
           client.source_data_invalid
    from client_gate client
    union all
    select sub_client.customer_kind,
           sub_client.customer_id,
           sub_client.display_name,
           sub_client.parent_client_id,
           sub_client.parent_display_name,
           sub_client.normalized_name,
           sub_client.match_kind,
           sub_client.match_tier,
           sub_client.source_data_invalid
    from sub_client_gate sub_client
  ), inspection_gate as materialized (
    select candidate.*
    from inspection_candidate candidate
    order by candidate.match_tier,
      candidate.customer_kind,
      candidate.normalized_name collate "C",
      candidate.customer_id
    limit 501
  ), inspection_state as materialized (
    select (select query_bound from client_name_literal_keyset_bound)
      or (select query_bound from client_email_keyset_bound)
      or (select query_bound from client_phone_keyset_bound)
      or (select query_bound from sub_client_name_literal_keyset_bound)
      or (select query_bound from sub_client_email_keyset_bound)
      or (select query_bound from sub_client_phone_keyset_bound)
      or (select count(*) = 501 from inspection_gate) as query_bound
  ), authorized_candidate as (
    select candidate.*
    from inspection_state state
    join inspection_gate candidate on not state.query_bound
    where candidate.customer_kind = 'client'
      and (
        p_clients_scope = 'all'
        or p_clients_scope = 'assigned' and exists (
          select 1
          from public.projects project
          join public.project_tasks task
            on task.project_id = project.id
           and task.company_id = p_company_id
           and task.deleted_at is null
           and task.team_member_ids @> array[p_actor_user_id::text]
          where project.company_id = p_company_id
            and project.deleted_at is null
            and project.client_id = candidate.customer_id
        )
      )
      and private.agent_user_can_access_entity(
        p_actor_user_id,
        p_company_id,
        'client',
        candidate.customer_id,
        'view'
      )
    union all
    select candidate.*
    from inspection_state state
    join inspection_gate candidate on not state.query_bound
    where candidate.customer_kind = 'sub_client'
      and (
        p_clients_scope = 'all'
        or p_clients_scope = 'assigned' and exists (
          select 1
          from public.projects project
          join public.project_tasks task
            on task.project_id = project.id
           and task.company_id = p_company_id
           and task.deleted_at is null
           and task.team_member_ids @> array[p_actor_user_id::text]
          where project.company_id = p_company_id
            and project.deleted_at is null
            and project.client_id = candidate.parent_client_id
        )
      )
      and private.agent_user_can_access_entity(
        p_actor_user_id,
        p_company_id,
        'client',
        candidate.parent_client_id,
        'view'
      )
      and private.agent_user_can_access_entity(
        p_actor_user_id,
        p_company_id,
        'sub_client',
        candidate.customer_id,
        'view'
      )
  ), candidate_gate as materialized (
    select candidate.*
    from authorized_candidate candidate
    order by candidate.match_tier,
      candidate.customer_kind,
      candidate.normalized_name collate "C",
      candidate.customer_id
    limit 501
  ), candidate_state as materialized (
    select case when state.query_bound then 501
             else count(candidate.customer_id)::integer
           end as authorized_candidate_count,
           state.query_bound,
           not state.query_bound and coalesce(
             bool_or(coalesce(candidate.source_data_invalid, true)) filter (
               where candidate.customer_id is not null
             ), false
           ) as source_data_invalid
    from inspection_state state
    left join candidate_gate candidate on not state.query_bound
    group by state.query_bound
  ), ranked_candidate as materialized (
    select candidate.*,
           row_number() over (
             order by candidate.match_tier,
               candidate.customer_kind,
               candidate.normalized_name collate "C",
               candidate.customer_id
           )::integer as rank_ordinal
    from candidate_gate candidate
    where not candidate.source_data_invalid
    order by candidate.match_tier,
      candidate.customer_kind,
      candidate.normalized_name collate "C",
      candidate.customer_id
    limit 500
  ), ranked_raw_match as materialized (
    select ranked.*,
           'evidence:customer_discovery_projection:' ||
             ranked.customer_kind || ':' || ranked.customer_id::text ||
             ':ordinal:' || ranked.rank_ordinal::text as evidence_id,
           case when p_lookup = 'name' then null else jsonb_build_object(
             'customer_ref', jsonb_build_object(
               'kind', ranked.customer_kind,
               'id', ranked.customer_id
             ),
             'lookup', p_lookup,
             'query_binding_hash', 'sha256:' || encode(
               extensions.digest(convert_to(
                 private.canonical_agent_projection_json(
                   jsonb_build_object(
                     'schema_revision',
                       'customer-discovery-contact-selection:v1',
                     'customer_ref', jsonb_build_object(
                       'kind', ranked.customer_kind,
                       'id', ranked.customer_id
                     ),
                     'lookup', p_lookup,
                     'normalized_query', p_query
                   )
                 ),
                 'UTF8'
               ), 'sha256'),
               'hex'
             )
           ) end as selection_witness,
           jsonb_build_object(
             'customer_ref', jsonb_build_object(
               'kind', ranked.customer_kind,
               'id', ranked.customer_id
             ),
             'display_name', private.agent_trim_discovery_display_text(
               ranked.display_name
             ),
             'relationship', case ranked.customer_kind
               when 'client' then jsonb_build_object(
                 'kind', 'primary_client'
               )
               else jsonb_build_object(
                 'kind', 'sub_client',
                 'parent_client_ref', jsonb_build_object(
                   'kind', 'client', 'id', ranked.parent_client_id
                 ),
                 'parent_display_name',
                   private.agent_trim_discovery_display_text(
                     ranked.parent_display_name
                   )
               ) end,
             'match_basis', jsonb_build_object(
               'ranking_revision', p_ranking_revision,
               'kind', ranked.match_kind
             ),
             'content_kind', 'untrusted_business_data',
             'visibility_reason', 'current_actor_authorized',
             'evidence_ids', jsonb_build_array(
               'evidence:customer_discovery_projection:' ||
                 ranked.customer_kind || ':' ||
                 ranked.customer_id::text || ':ordinal:' ||
                 ranked.rank_ordinal::text
             )
           ) as raw
    from ranked_candidate ranked
  ), cursor_anchor as materialized (
    select p_cursor_rank_ordinal is null or exists (
      select 1
      from ranked_raw_match candidate
      where candidate.rank_ordinal = p_cursor_rank_ordinal
        and candidate.customer_kind = p_cursor_customer_kind
        and candidate.customer_id = p_cursor_customer_id
    ) as valid,
    case when p_cursor_rank_ordinal is null then null else (
      select jsonb_build_object(
        'rank_ordinal', candidate.rank_ordinal,
        'raw', candidate.raw
      )
      from ranked_raw_match candidate
      where candidate.rank_ordinal = p_cursor_rank_ordinal
        and candidate.customer_kind = p_cursor_customer_kind
        and candidate.customer_id = p_cursor_customer_id
    ) end as order_witness
  ), page_plus_one as materialized (
    select candidate.*
    from ranked_raw_match candidate
    cross join candidate_state state
    cross join cursor_anchor cursor_state
    where not state.query_bound
      and not state.source_data_invalid
      and cursor_state.valid
      and candidate.rank_ordinal > coalesce(p_cursor_rank_ordinal, 0)
    order by candidate.rank_ordinal
    limit p_limit + 1
  ), retained_page as materialized (
    select page.*
    from page_plus_one page
    order by page.rank_ordinal
    limit p_limit
  ), page_state as materialized (
    select state.authorized_candidate_count,
           state.query_bound,
           state.source_data_invalid,
           case when state.query_bound or state.source_data_invalid
             then 0 else (select count(*) from page_plus_one) end::integer
             as raw_page_count,
           case when state.query_bound or state.source_data_invalid
             then '[]'::jsonb else coalesce((
               select jsonb_agg(jsonb_build_object(
                 'rank_ordinal', page.rank_ordinal,
                 'source_kind', page.customer_kind,
                 'source_id', page.customer_id
               ) order by page.rank_ordinal)
               from page_plus_one page
             ), '[]'::jsonb) end as page_rows,
           case when state.query_bound or state.source_data_invalid
             then false else (select count(*) from page_plus_one) > p_limit
             end as has_more
    from candidate_state state
  ), canonical_request as materialized (
    select jsonb_build_object(
      'lookup', p_lookup,
      'query', p_query,
      'customer_kinds', to_jsonb(p_customer_kinds),
      'limit', p_limit
    ) as canonical_input
  ), match_projection as materialized (
    select match.*,
           context.source_revision,
           jsonb_build_object(
             'actor_user_id', p_actor_user_id,
             'company_id', p_company_id,
             'capability_id', p_capability_id,
             'capability_revision', p_capability_revision,
             'capability_manifest_revision',
               p_capability_manifest_revision,
             'schema_revision', p_capability_schema_revision,
             'permission_snapshot_revision',
               p_permission_snapshot_revision,
             'canonical_input', request.canonical_input,
             'read_at', private.agent_rfc3339_utc(v_read_as_of),
             'source_revision', context.source_revision,
             'ranking_revision', p_ranking_revision,
             'retained_proof_sources', '[]'::jsonb,
             'rank_ordinal', match.rank_ordinal
           ) || case when match.selection_witness is null then '{}'::jsonb
             else jsonb_build_object(
               'selection_witness', match.selection_witness
             ) end || jsonb_build_object(
               'match', match.raw
             ) as projection
    from retained_page match
    cross join authority_context context
    cross join canonical_request request
  ), match_hashed as materialized (
    select projection.*,
           'sha256:' || encode(extensions.digest(convert_to(
             private.canonical_agent_projection_json(projection.projection),
             'UTF8'
           ), 'sha256'), 'hex') as source_content_hash
    from match_projection projection
  ), match_claim as materialized (
    select match.*,
           jsonb_build_object(
             'source_domain', 'operations',
             'source_type', 'customer_discovery_projection',
             'source_id', match.customer_kind || ':' ||
               match.customer_id::text || ':ordinal:' ||
               match.rank_ordinal::text,
             'version', 'customer_discovery_projection:v1:' ||
               match.source_content_hash
           ) as source_version
    from match_hashed match
  ), next_cursor as materialized (
    select case when page.has_more then (
      select jsonb_build_object(
        'source_revision', context.source_revision,
        'read_as_of', private.agent_rfc3339_utc(v_read_as_of),
        'rank_ordinal', last_match.rank_ordinal,
        'source_kind', last_match.customer_kind,
        'source_id', last_match.customer_id
      )
      from retained_page last_match
      order by last_match.rank_ordinal desc
      limit 1
    ) else null end as claims
    from page_state page
    cross join authority_context context
  ), collection_raw as materialized (
    select jsonb_build_object(
      'authorized_candidate_count', page.authorized_candidate_count,
      'raw_page_count', page.raw_page_count,
      'page_rows', page.page_rows,
      'returned_match_count', case
        when page.query_bound or page.source_data_invalid then 0
        else (select count(*) from match_claim) end,
      'has_more', page.has_more,
      'next_cursor_claims', cursor.claims,
      'cursor_anchor_order_witness', cursor_state.order_witness,
      'gaps', case
        when page.query_bound then jsonb_build_array('SOURCE_QUERY_BOUND')
        when page.source_data_invalid
          then jsonb_build_array('SOURCE_DATA_INVALID')
        else '[]'::jsonb end
    ) as raw
    from page_state page
    cross join next_cursor cursor
    cross join cursor_anchor cursor_state
  ), collection_projection as materialized (
    select collection.raw,
           context.source_revision,
           jsonb_build_object(
             'actor_user_id', p_actor_user_id,
             'company_id', p_company_id,
             'capability_id', p_capability_id,
             'capability_revision', p_capability_revision,
             'capability_manifest_revision',
               p_capability_manifest_revision,
             'schema_revision', p_capability_schema_revision,
             'permission_snapshot_revision',
               p_permission_snapshot_revision,
             'canonical_input', request.canonical_input,
             'read_at', private.agent_rfc3339_utc(v_read_as_of),
             'source_revision', context.source_revision,
             'ranking_revision', p_ranking_revision,
             'retained_proof_sources', coalesce((
               select jsonb_agg(match.source_version
                 order by match.rank_ordinal)
               from match_claim match
             ), '[]'::jsonb),
             'collection', collection.raw
           ) as projection
    from collection_raw collection
    cross join authority_context context
    cross join canonical_request request
    cross join cursor_anchor cursor_state
    where cursor_state.valid
  ), collection_hashed as materialized (
    select collection.*,
           'sha256:' || encode(extensions.digest(convert_to(
             private.canonical_agent_projection_json(collection.projection),
             'UTF8'
           ), 'sha256'), 'hex') as source_content_hash
    from collection_projection collection
  ), final_result as materialized (
    select jsonb_build_object(
      'company_id', p_company_id,
      'permission_snapshot_revision', p_permission_snapshot_revision,
      'read_at', private.agent_rfc3339_utc(v_read_as_of),
      'source_fence', jsonb_build_object(
        'source_domain', 'operations',
        'source_type', 'operational_read_revision',
        'source_id', 'private.agent_operational_read_revisions',
        'version', 'revision:' || collection.source_revision::text
      ),
      'ranking_revision', p_ranking_revision,
      'authorized_candidate_count', collection.raw ->
        'authorized_candidate_count',
      'raw_page_count', collection.raw -> 'raw_page_count',
      'page_rows', collection.raw -> 'page_rows',
      'match_claims', coalesce((
        select jsonb_agg(jsonb_build_object(
          'rank_ordinal', match.rank_ordinal,
          'raw', match.raw,
          'proof', jsonb_build_object(
            'source_version', match.source_version,
            'source_content_hash', match.source_content_hash,
            'evidence_id', match.evidence_id,
            'projection', match.projection
          ),
          'source_version', match.source_version,
          'evidence', jsonb_build_array(jsonb_build_object(
            'evidence_id', match.evidence_id,
            'source_domain', 'operations',
            'source_type', 'customer_discovery_projection',
            'source_id', match.customer_kind || ':' ||
              match.customer_id::text || ':ordinal:' ||
              match.rank_ordinal::text,
            'version', match.source_version ->> 'version',
            'occurred_at', private.agent_rfc3339_utc(v_read_as_of),
            'relationship', 'supports',
            'locator', 'ops://evidence/' || replace(
              match.evidence_id, ':', '%3A'
            ),
            'trust', 'authoritative_ops'
          ))
        ) || case when match.selection_witness is null then '{}'::jsonb
          else jsonb_build_object(
            'selection_witness', match.selection_witness
          ) end
        order by match.rank_ordinal)
        from match_claim match
      ), '[]'::jsonb),
      'returned_match_count', collection.raw -> 'returned_match_count',
      'has_more', collection.raw -> 'has_more',
      'next_cursor_claims', collection.raw -> 'next_cursor_claims',
      'gaps', collection.raw -> 'gaps',
      'collection_claim', jsonb_build_object(
        'raw', collection.raw,
        'proof', jsonb_build_object(
          'source_version', jsonb_build_object(
            'source_domain', 'operations',
            'source_type', 'customer_discovery_collection_projection',
            'source_id', 'company:' || p_company_id::text,
            'version', 'customer_discovery_collection_projection:v1:' ||
              collection.source_content_hash
          ),
          'source_content_hash', collection.source_content_hash,
          'evidence_id',
            'evidence:customer_discovery_collection_projection:company:' ||
              p_company_id::text,
          'projection', collection.projection
        ),
        'source_version', jsonb_build_object(
          'source_domain', 'operations',
          'source_type', 'customer_discovery_collection_projection',
          'source_id', 'company:' || p_company_id::text,
          'version', 'customer_discovery_collection_projection:v1:' ||
            collection.source_content_hash
        ),
        'evidence', jsonb_build_array(jsonb_build_object(
          'evidence_id',
            'evidence:customer_discovery_collection_projection:company:' ||
              p_company_id::text,
          'source_domain', 'operations',
          'source_type', 'customer_discovery_collection_projection',
          'source_id', 'company:' || p_company_id::text,
          'version', 'customer_discovery_collection_projection:v1:' ||
            collection.source_content_hash,
          'occurred_at', private.agent_rfc3339_utc(v_read_as_of),
          'relationship', 'supports',
          'locator', 'ops://evidence/' || replace(
            'evidence:customer_discovery_collection_projection:company:' ||
              p_company_id::text,
            ':', '%3A'
          ),
          'trust', 'authoritative_ops'
        ))
      )
    ) as result
    from collection_hashed collection
  )
  select final.result
  into v_result
  from final_result final;

  if v_result is null then
    if p_cursor_source_revision is not null then
      raise exception 'agent_customer_discovery_cursor_stale'
        using errcode = '40001', detail = coalesce((
          select jsonb_build_object(
            'source_domain', 'operations',
            'source_type', 'operational_read_revision',
            'source_id', 'private.agent_operational_read_revisions',
            'version', 'revision:' || revision.source_revision::text
          )::text
          from private.agent_operational_read_revisions revision
          where revision.company_id = p_company_id
            and revision.source_revision between 0 and 9007199254740991
        ), '{}');
    end if;
    raise exception 'agent_customer_discovery_not_found_or_not_visible'
      using errcode = 'P0002';
  end if;
  if octet_length(v_result::text) > 1048576 then
    raise exception 'agent_customer_discovery_source_query_bound'
      using errcode = '54000';
  end if;
  return v_result;
end;
$function$;

revoke all on function public.read_agent_customer_discovery_as_system(
  text, uuid, uuid, text, text[], text, text, text, text, text, text[], text,
  text, text, text[], timestamptz, bigint, integer, text, uuid, integer
) from public, anon, authenticated, service_role;
grant execute on function public.read_agent_customer_discovery_as_system(
  text, uuid, uuid, text, text[], text, text, text, text, text, text[], text,
  text, text, text[], timestamptz, bigint, integer, text, uuid, integer
) to service_role;

create or replace function public.read_agent_job_discovery_as_system(
  p_request_id text,
  p_actor_user_id uuid,
  p_company_id uuid,
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_capability_id text,
  p_capability_revision text,
  p_capability_manifest_revision text,
  p_capability_schema_revision text,
  p_ranking_revision text,
  p_required_oauth_scopes text[],
  p_pipeline_scope text,
  p_projects_scope text,
  p_query text,
  p_query_fields text[],
  p_job_kinds text[],
  p_lifecycle_states text[],
  p_opportunity_stages text[],
  p_project_statuses text[],
  p_date_field text,
  p_date_from timestamptz,
  p_date_to_exclusive timestamptz,
  p_read_as_of timestamptz,
  p_cursor_source_revision bigint,
  p_cursor_rank_ordinal integer,
  p_cursor_job_kind text,
  p_cursor_job_id uuid,
  p_limit integer
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private, extensions, pg_temp
set plan_cache_mode = force_custom_plan
as $function$
declare
  v_expected_oauth_scopes text[];
  v_read_as_of timestamptz;
  v_result jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  -- Keep infinity arithmetic out of the main validation expression: SQL
  -- boolean terms are not required to short-circuit in source order.
  if (p_date_from is not null and not isfinite(p_date_from))
     or (p_date_to_exclusive is not null and
       not isfinite(p_date_to_exclusive)) then
    raise exception 'invalid_agent_job_discovery_request'
      using errcode = '22023';
  end if;
  if (p_date_from is not null and extract(
        year from p_date_from at time zone 'UTC'
      ) not between 1 and 9999)
     or (p_date_to_exclusive is not null and extract(
       year from p_date_to_exclusive at time zone 'UTC'
     ) not between 1 and 9999) then
    raise exception 'invalid_agent_job_discovery_request'
      using errcode = '22023';
  end if;
  if p_request_id is null
     or p_request_id is distinct from btrim(p_request_id)
     or octet_length(p_request_id) not between 1 and 256
     or p_actor_user_id is null
     or p_company_id is null
     or p_permission_snapshot_revision is null
     or p_permission_snapshot_revision !~ '^sha256:[0-9a-f]{64}$'
     or p_registered_permission_keys is null
     or p_capability_id is distinct from 'search_jobs'
     or p_capability_revision is distinct from
       'search_jobs:2026-08-20.v1'
     or p_capability_manifest_revision is distinct from
       '2026-08-20.capability-manifest.v7'
     or p_capability_schema_revision is distinct from '2026-08-20.v1'
     or p_ranking_revision is distinct from 'job-discovery-ranking:v1'
     or p_required_oauth_scopes is distinct from
       array['ops.jobs.read']::text[]
     or p_job_kinds is null
     or cardinality(p_job_kinds) not between 1 and 2
     or p_job_kinds <@ array['opportunity', 'project']::text[] is not true
     or (select count(distinct requested.kind)
         from unnest(p_job_kinds) requested(kind)) <>
       cardinality(p_job_kinds)
     or ('opportunity' = any(p_job_kinds)) is distinct from
       (p_pipeline_scope is not null)
     or ('project' = any(p_job_kinds)) is distinct from
       (p_projects_scope is not null)
     or p_pipeline_scope is not null and
       p_pipeline_scope not in ('all', 'assigned')
     or p_projects_scope is not null and
       p_projects_scope not in ('all', 'assigned')
     or (p_query is null) is distinct from (p_query_fields is null)
     or p_query is not null and
       private.agent_discovery_query_is_valid(p_query) is not true
     or p_query_fields is not null and (
       cardinality(p_query_fields) not between 1 and 2
       or p_query_fields <@ array['title', 'address']::text[] is not true
       or (select count(distinct requested.field)
           from unnest(p_query_fields) requested(field)) <>
         cardinality(p_query_fields)
     )
     or p_lifecycle_states is not null and (
       cardinality(p_lifecycle_states) not between 1 and 3
       or p_lifecycle_states <@
         array['active', 'terminal', 'archived']::text[] is not true
       or (select count(distinct requested.state)
           from unnest(p_lifecycle_states) requested(state)) <>
         cardinality(p_lifecycle_states)
     )
     or p_opportunity_stages is not null and (
       not ('opportunity' = any(p_job_kinds))
       or cardinality(p_opportunity_stages) not between 1 and 9
       or p_opportunity_stages <@ array[
         'new_lead', 'qualifying', 'quoting', 'quoted', 'follow_up',
         'negotiation', 'won', 'lost', 'discarded'
       ]::text[] is not true
       or (select count(distinct requested.stage)
           from unnest(p_opportunity_stages) requested(stage)) <>
         cardinality(p_opportunity_stages)
     )
     or p_project_statuses is not null and (
       not ('project' = any(p_job_kinds))
       or cardinality(p_project_statuses) not between 1 and 7
       or p_project_statuses <@ array[
         'rfq', 'estimated', 'accepted', 'in_progress', 'completed',
         'closed', 'archived'
       ]::text[] is not true
       or (select count(distinct requested.status)
           from unnest(p_project_statuses) requested(status)) <>
         cardinality(p_project_statuses)
     )
     or (
       p_lifecycle_states is not null
       and not (
         (
           'opportunity' = any(p_job_kinds)
           and (
             p_opportunity_stages is null
             or exists (
               select 1
               from unnest(p_opportunity_stages) requested(stage)
               where case
                 when requested.stage = 'discarded' then
                   'archived' = any(p_lifecycle_states)
                 when requested.stage in ('won', 'lost') then
                   p_lifecycle_states &&
                     array['terminal', 'archived']::text[]
                 else p_lifecycle_states &&
                   array['active', 'archived']::text[]
               end
             )
           )
         )
         or (
           'project' = any(p_job_kinds)
           and (
             p_project_statuses is null
             or exists (
               select 1
               from unnest(p_project_statuses) requested(status)
               where case
                 when requested.status = 'archived' then
                   'archived' = any(p_lifecycle_states)
                 when requested.status in ('completed', 'closed') then
                   'terminal' = any(p_lifecycle_states)
                 else 'active' = any(p_lifecycle_states)
               end
             )
           )
         )
       )
     )
     or (p_date_field is null) is distinct from (p_date_from is null)
     or (p_date_field is null) is distinct from
       (p_date_to_exclusive is null)
     or p_date_field is not null and
       p_date_field not in ('created_at', 'updated_at')
     or p_date_from is not null and (
       p_date_to_exclusive <= p_date_from
       or p_date_to_exclusive - p_date_from > interval '365 days'
     )
     or p_date_from is not null and p_date_from is distinct from
       date_trunc('milliseconds', p_date_from, 'UTC')
     or p_date_to_exclusive is not null and
       p_date_to_exclusive is distinct from
         date_trunc('milliseconds', p_date_to_exclusive, 'UTC')
     or p_query is null
        and p_lifecycle_states is null
        and p_opportunity_stages is null
        and p_project_statuses is null
        and p_date_field is null
     or p_limit is null
     or p_limit not between 1 and 25
     or p_read_as_of is not null and not isfinite(p_read_as_of)
     or p_read_as_of is not null and extract(
       year from p_read_as_of at time zone 'UTC'
     ) not between 1 and 9999
     or p_read_as_of is not null and p_read_as_of is distinct from
       date_trunc('milliseconds', p_read_as_of, 'UTC')
     or (p_read_as_of is null) is distinct from
       (p_cursor_source_revision is null)
     or (p_cursor_source_revision is null) is distinct from
       (p_cursor_rank_ordinal is null)
     or (p_cursor_source_revision is null) is distinct from
       (p_cursor_job_kind is null)
     or (p_cursor_source_revision is null) is distinct from
       (p_cursor_job_id is null)
     or p_cursor_source_revision is not null and
       p_cursor_source_revision not between 0 and 9007199254740991
     or p_cursor_rank_ordinal is not null and
       p_cursor_rank_ordinal not between 1 and 500
     or p_cursor_job_kind is not null and
       p_cursor_job_kind not in ('opportunity', 'project') then
    raise exception 'invalid_agent_job_discovery_request'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from unnest(p_registered_permission_keys) registry(permission_key)
    where registry.permission_key is null
       or registry.permission_key is distinct from btrim(registry.permission_key)
       or octet_length(registry.permission_key) not between 1 and 128
  ) or (
    select count(distinct registry.permission_key)
    from unnest(p_registered_permission_keys) registry(permission_key)
  ) <> cardinality(p_registered_permission_keys)
  or ('opportunity' = any(p_job_kinds)
      and not ('pipeline.view' = any(p_registered_permission_keys)))
  or ('project' = any(p_job_kinds)
      and not ('projects.view' = any(p_registered_permission_keys))) then
    raise exception 'invalid_agent_job_discovery_request'
      using errcode = '22023';
  end if;

  select array_agg(requested.scope order by requested.scope)
  into v_expected_oauth_scopes
  from (select 'ops.jobs.read'::text as scope) requested;
  if p_required_oauth_scopes is distinct from v_expected_oauth_scopes then
    raise exception 'invalid_agent_job_discovery_request'
      using errcode = '22023';
  end if;

  v_read_as_of := date_trunc(
    'milliseconds', coalesce(p_read_as_of, statement_timestamp())
  );

  with current_authority as materialized (
    select authority.permission_snapshot_revision,
           max(permission.value ->> 'scope') filter (
             where permission.value ->> 'permission' = 'pipeline.view'
           ) as pipeline_scope,
           max(permission.value ->> 'scope') filter (
             where permission.value ->> 'permission' = 'projects.view'
           ) as projects_scope
    from private.resolve_agent_actor_authority(
      p_actor_user_id,
      p_company_id,
      p_registered_permission_keys
    ) authority
    cross join lateral jsonb_array_elements(
      authority.effective_permissions
    ) permission(value)
    group by authority.permission_snapshot_revision
  ), authority_context as materialized (
    select authority.permission_snapshot_revision,
           revision.source_revision,
           date_trunc('milliseconds', statement_timestamp()) as statement_read_at
    from current_authority authority
    join public.companies company
      on company.id = p_company_id
     and company.deleted_at is null
    join private.agent_operational_read_revisions revision
      on revision.company_id = p_company_id
     and revision.source_revision between 0 and 9007199254740991
    where authority.permission_snapshot_revision =
            p_permission_snapshot_revision
      and (p_pipeline_scope is null
        or authority.pipeline_scope = p_pipeline_scope)
      and (p_projects_scope is null
        or authority.projects_scope = p_projects_scope)
      and (p_cursor_source_revision is null
        or revision.source_revision = p_cursor_source_revision)
      and v_read_as_of <=
        date_trunc('milliseconds', statement_timestamp())
  ), query_tokens as materialized (
    select regexp_split_to_array(p_query, ' ') as values
    where p_query is not null
  ), opportunity_base_source as not materialized (
    select opportunity.id as raw_job_id,
           'opportunity'::text as raw_job_kind,
           opportunity.title,
           opportunity.address,
           opportunity.stage as status,
           case
             when opportunity.archived_at is not null
               or opportunity.stage = 'discarded' then 'archived'
             when opportunity.stage in ('won', 'lost') then 'terminal'
             else 'active'
           end as lifecycle_state,
           opportunity.created_at,
           opportunity.updated_at,
           opportunity.assigned_to,
           opportunity.archived_at is not null as is_archived,
           null::date as start_date,
           null::date as end_date,
           date_trunc('milliseconds', opportunity.created_at, 'UTC')
             as created_sort_at,
           date_trunc('milliseconds', opportunity.updated_at, 'UTC')
             as updated_sort_at,
           date_trunc('milliseconds', case
             when coalesce(p_date_field, 'updated_at') = 'created_at'
               then opportunity.created_at else opportunity.updated_at
           end, 'UTC') as sort_at,
           private.resolve_opportunity_client_id(
             opportunity.client_ref,
             opportunity.client_id
           ) as resolved_client_id,
           coalesce(opportunity.project_ref, opportunity.project_id)
             as linked_project_id,
           normalized.title as normalized_title,
           normalized.address as normalized_address,
           jsonb_build_object(
             'job_ref', jsonb_build_object(
               'kind', 'opportunity', 'id', opportunity.id
             ),
             'display_title', private.agent_trim_discovery_display_text(
               opportunity.title
             ),
             'address', case when opportunity.address is null then null
               else private.agent_trim_discovery_display_text(
                 opportunity.address
               ) end,
             'archived', opportunity.archived_at is not null,
             'lifecycle_state', case
               when opportunity.archived_at is not null
                 or opportunity.stage = 'discarded' then 'archived'
               when opportunity.stage in ('won', 'lost') then 'terminal'
               else 'active'
             end,
             'status', jsonb_build_object(
               'kind', 'opportunity', 'value', opportunity.stage
             ),
             'dates', jsonb_build_object(
               'kind', 'opportunity',
               'created_at', case when isfinite(opportunity.created_at)
                 and extract(
                   year from opportunity.created_at at time zone 'UTC'
                 ) between 1 and 9999
                 then private.agent_rfc3339_utc(opportunity.created_at)
                 else null end,
               'updated_at', case when isfinite(opportunity.updated_at)
                 and extract(
                   year from opportunity.updated_at at time zone 'UTC'
                 ) between 1 and 9999
                 then private.agent_rfc3339_utc(opportunity.updated_at)
                 else null end
             )
           ) as selection_anchor_base,
           private.agent_discovery_opportunity_source_is_invalid(
             opportunity.client_ref,
             opportunity.client_id,
             opportunity.project_ref,
             opportunity.project_id,
             opportunity.title,
             opportunity.address,
             opportunity.stage,
             opportunity.created_at,
             opportunity.updated_at,
             opportunity.archived_at
           ) as static_source_data_invalid,
           coalesce((
             private.agent_discovery_opportunity_source_is_invalid(
               opportunity.client_ref,
               opportunity.client_id,
               opportunity.project_ref,
               opportunity.project_id,
               opportunity.title,
               opportunity.address,
               opportunity.stage,
               opportunity.created_at,
               opportunity.updated_at,
               opportunity.archived_at
             )
             or date_trunc(
               'milliseconds', opportunity.updated_at, 'UTC'
             ) > v_read_as_of
           ), true) as source_data_invalid
    from authority_context context
    join public.opportunities opportunity
      on opportunity.company_id = p_company_id
     and opportunity.deleted_at is null
     and opportunity.merged_into_opportunity_id is null
    cross join lateral (
      select private.agent_normalize_discovery_text(opportunity.title)
               collate "C" as title,
             private.agent_normalize_discovery_text(opportunity.address)
               collate "C" as address
    ) normalized
    where 'opportunity' = any(p_job_kinds)
      and case when opportunity.stage is null
        or opportunity.stage not in (
          'new_lead', 'qualifying', 'quoting', 'quoted', 'follow_up',
          'negotiation', 'won', 'lost', 'discarded'
        ) then '__invalid__' else opportunity.stage end = any(
          array_append(coalesce(p_opportunity_stages, array[
            'new_lead', 'qualifying', 'quoting', 'quoted', 'follow_up',
            'negotiation', 'won', 'lost', 'discarded'
          ]::text[]), '__invalid__')
        )
      and case when opportunity.stage is null
        or opportunity.stage not in (
          'new_lead', 'qualifying', 'quoting', 'quoted', 'follow_up',
          'negotiation', 'won', 'lost', 'discarded'
        ) then '__invalid__'
        when opportunity.archived_at is not null
          or opportunity.stage = 'discarded' then 'archived'
        when opportunity.stage in ('won', 'lost') then 'terminal'
        else 'active' end = any(array_append(
          coalesce(p_lifecycle_states, array[
            'active', 'terminal', 'archived'
          ]::text[]),
          '__invalid__'
        ))
  ), project_base_source as not materialized (
    select project.id as raw_job_id,
           'project'::text as raw_job_kind,
           project.title,
           project.address,
           project.status,
           case
             when project.status = 'archived' then 'archived'
             when project.status in ('completed', 'closed') then 'terminal'
             else 'active'
           end as lifecycle_state,
           project.created_at,
           project.updated_at,
           project.start_date,
           project.end_date,
           date_trunc('milliseconds', project.created_at, 'UTC')
             as created_sort_at,
           date_trunc('milliseconds', project.updated_at, 'UTC')
             as updated_sort_at,
           date_trunc('milliseconds', case
             when coalesce(p_date_field, 'updated_at') = 'created_at'
               then project.created_at else project.updated_at
           end, 'UTC') as sort_at,
           project.client_id,
           coalesce(
             project.opportunity_ref,
             private.agent_uuid_from_legacy_text(project.opportunity_id)
           ) as linked_opportunity_id,
           normalized.title as normalized_title,
           normalized.address as normalized_address,
           jsonb_build_object(
             'job_ref', jsonb_build_object(
               'kind', 'project', 'id', project.id
             ),
             'display_title', private.agent_trim_discovery_display_text(
               project.title
             ),
             'address', case when project.address is null then null
               else private.agent_trim_discovery_display_text(
                 project.address
               ) end,
             'lifecycle_state', case
               when project.status = 'archived' then 'archived'
               when project.status in ('completed', 'closed') then 'terminal'
               else 'active'
             end,
             'status', jsonb_build_object(
               'kind', 'project', 'value', project.status
             ),
             'dates', jsonb_build_object(
               'kind', 'project',
               'created_at', case when isfinite(project.created_at)
                 and extract(
                   year from project.created_at at time zone 'UTC'
                 ) between 1 and 9999
                 then private.agent_rfc3339_utc(project.created_at)
                 else null end,
               'updated_at', case when isfinite(project.updated_at)
                 and extract(
                   year from project.updated_at at time zone 'UTC'
                 ) between 1 and 9999
                 then private.agent_rfc3339_utc(project.updated_at)
                 else null end,
               'start_date', case when project.start_date is null
                 or not isfinite(project.start_date)
                 or extract(
                   year from project.start_date at time zone 'UTC'
                 ) not between 1 and 9999 then null
                 else to_char(
                   project.start_date at time zone 'UTC', 'YYYY-MM-DD'
                 ) end,
               'end_date', case when project.end_date is null
                 or not isfinite(project.end_date)
                 or extract(
                   year from project.end_date at time zone 'UTC'
                 ) not between 1 and 9999 then null
                 else to_char(
                   project.end_date at time zone 'UTC', 'YYYY-MM-DD'
                 ) end
             )
           ) as selection_anchor_base,
           private.agent_discovery_project_source_is_invalid(
             project.opportunity_id,
             project.opportunity_ref,
             project.title,
             project.address,
             project.status,
             project.created_at,
             project.updated_at,
             project.start_date,
             project.end_date
           ) as static_source_data_invalid,
           coalesce((
             private.agent_discovery_project_source_is_invalid(
               project.opportunity_id,
               project.opportunity_ref,
               project.title,
               project.address,
               project.status,
               project.created_at,
               project.updated_at,
               project.start_date,
               project.end_date
             )
             or date_trunc(
               'milliseconds', project.updated_at, 'UTC'
             ) > v_read_as_of
           ), true) as source_data_invalid
    from authority_context context
    join public.projects project
      on project.company_id = p_company_id
     and project.deleted_at is null
    cross join lateral (
      select private.agent_normalize_discovery_text(project.title)
               collate "C" as title,
             private.agent_normalize_discovery_text(project.address)
               collate "C" as address
    ) normalized
    where 'project' = any(p_job_kinds)
      and case when project.status is null or project.status not in (
        'rfq', 'estimated', 'accepted', 'in_progress', 'completed',
        'closed', 'archived'
      ) then '__invalid__' else project.status end = any(array_append(
        coalesce(p_project_statuses, array[
          'rfq', 'estimated', 'accepted', 'in_progress', 'completed',
          'closed', 'archived'
        ]::text[]),
        '__invalid__'
      ))
      and case when project.status is null or project.status not in (
        'rfq', 'estimated', 'accepted', 'in_progress', 'completed',
        'closed', 'archived'
      ) then '__invalid__'
        when project.status = 'archived' then 'archived'
        when project.status in ('completed', 'closed') then 'terminal'
        else 'active' end = any(array_append(
          coalesce(p_lifecycle_states, array[
            'active', 'terminal', 'archived'
          ]::text[]),
          '__invalid__'
        ))
  ), opportunity_inspection_source as not materialized (
    select candidate.*
    from opportunity_base_source candidate
  ), project_inspection_source as not materialized (
    select candidate.*
    from project_base_source candidate
  ), opportunity_query_source as not materialized (
    select candidate.*
    from opportunity_inspection_source candidate
    where p_query is not null
      and (p_date_from is null
        or p_date_field = 'created_at' and
          candidate.created_sort_at >= p_date_from
        or p_date_field = 'updated_at' and
          candidate.updated_sort_at >= p_date_from)
      and (p_date_to_exclusive is null
        or p_date_field = 'created_at' and
          candidate.created_sort_at < p_date_to_exclusive
        or p_date_field = 'updated_at' and
          candidate.updated_sort_at < p_date_to_exclusive)
  ), opportunity_filter_created_source as not materialized (
    select candidate.*
    from opportunity_inspection_source candidate
    where p_query is null
      and p_date_field = 'created_at'
      and candidate.created_sort_at >= p_date_from
      and candidate.created_sort_at < p_date_to_exclusive
  ), opportunity_filter_updated_no_window_source as not materialized (
    select candidate.*
    from opportunity_inspection_source candidate
    where p_query is null
      and p_date_field is null
  ), opportunity_filter_updated_no_window_selector as materialized (
    select selector.stage, selector.is_archived
    from (values
      ('new_lead', false, 'active'),
      ('new_lead', true, 'archived'),
      ('qualifying', false, 'active'),
      ('qualifying', true, 'archived'),
      ('quoting', false, 'active'),
      ('quoting', true, 'archived'),
      ('quoted', false, 'active'),
      ('quoted', true, 'archived'),
      ('follow_up', false, 'active'),
      ('follow_up', true, 'archived'),
      ('negotiation', false, 'active'),
      ('negotiation', true, 'archived'),
      ('won', false, 'terminal'),
      ('won', true, 'archived'),
      ('lost', false, 'terminal'),
      ('lost', true, 'archived'),
      ('discarded', false, 'archived'),
      ('discarded', true, 'archived')
    ) selector(stage, is_archived, lifecycle_state)
    where p_query is null
      and p_date_field is null
      and 'opportunity' = any(p_job_kinds)
      and (p_opportunity_stages is null
        or selector.stage = any(p_opportunity_stages))
      and (p_lifecycle_states is null
        or selector.lifecycle_state = any(p_lifecycle_states))
  ), opportunity_filter_updated_no_window_selected_candidate
      as materialized (
    select selected.raw_job_id, selected.updated_sort_at
    from authority_context context
    join opportunity_filter_updated_no_window_selector selector on true
    cross join lateral (
      select opportunity.id as raw_job_id,
             date_trunc('milliseconds', opportunity.updated_at, 'UTC')
               as updated_sort_at
      from public.opportunities opportunity
      where opportunity.company_id = p_company_id
        and opportunity.deleted_at is null
        and opportunity.merged_into_opportunity_id is null
        and opportunity.stage = selector.stage
        and (opportunity.archived_at is not null) = selector.is_archived
      order by date_trunc(
          'milliseconds', opportunity.updated_at, 'UTC'
        ) desc nulls last,
        opportunity.id
      limit 501
    ) selected
    order by selected.updated_sort_at desc nulls last,
      selected.raw_job_id
    limit 501
  ), opportunity_filter_updated_no_window_invalid_candidate
      as materialized (
    select opportunity.id as raw_job_id,
           date_trunc('milliseconds', opportunity.updated_at, 'UTC')
             as updated_sort_at
    from public.opportunities opportunity
    where p_query is null
      and p_date_field is null
      and 'opportunity' = any(p_job_kinds)
      and opportunity.company_id = p_company_id
      and opportunity.deleted_at is null
      and opportunity.merged_into_opportunity_id is null
      and (opportunity.stage is null or opportunity.stage not in (
        'new_lead', 'qualifying', 'quoting', 'quoted', 'follow_up',
        'negotiation', 'won', 'lost', 'discarded'
      ))
    order by date_trunc(
        'milliseconds', opportunity.updated_at, 'UTC'
      ) desc nulls last,
      opportunity.id
    limit 501
  ), opportunity_filter_updated_no_window_keyset as materialized (
    select candidate.*
    from (
      select selected.*
      from opportunity_filter_updated_no_window_selected_candidate selected
      union all
      select invalid.*
      from opportunity_filter_updated_no_window_invalid_candidate invalid
    ) candidate
    order by candidate.updated_sort_at desc nulls last,
      candidate.raw_job_id
    limit 501
  ), opportunity_filter_updated_window_source as not materialized (
    select candidate.*
    from opportunity_inspection_source candidate
    where p_query is null
      and p_date_field = 'updated_at'
      and candidate.updated_sort_at >= p_date_from
      and candidate.updated_sort_at < p_date_to_exclusive
  ), project_query_source as not materialized (
    select candidate.*
    from project_inspection_source candidate
    where p_query is not null
      and (p_date_from is null
        or p_date_field = 'created_at' and
          candidate.created_sort_at >= p_date_from
        or p_date_field = 'updated_at' and
          candidate.updated_sort_at >= p_date_from)
      and (p_date_to_exclusive is null
        or p_date_field = 'created_at' and
          candidate.created_sort_at < p_date_to_exclusive
        or p_date_field = 'updated_at' and
          candidate.updated_sort_at < p_date_to_exclusive)
  ), project_filter_created_source as not materialized (
    select candidate.*
    from project_inspection_source candidate
    where p_query is null
      and p_date_field = 'created_at'
      and candidate.created_sort_at >= p_date_from
      and candidate.created_sort_at < p_date_to_exclusive
  ), project_filter_updated_no_window_source as not materialized (
    select candidate.*
    from project_inspection_source candidate
    where p_query is null
      and p_date_field is null
  ), project_filter_updated_no_window_selector as materialized (
    select selector.status
    from (values
      ('rfq', 'active'),
      ('estimated', 'active'),
      ('accepted', 'active'),
      ('in_progress', 'active'),
      ('completed', 'terminal'),
      ('closed', 'terminal'),
      ('archived', 'archived')
    ) selector(status, lifecycle_state)
    where p_query is null
      and p_date_field is null
      and 'project' = any(p_job_kinds)
      and (p_project_statuses is null
        or selector.status = any(p_project_statuses))
      and (p_lifecycle_states is null
        or selector.lifecycle_state = any(p_lifecycle_states))
  ), project_filter_updated_no_window_selected_candidate as materialized (
    select selected.raw_job_id, selected.updated_sort_at
    from authority_context context
    join project_filter_updated_no_window_selector selector on true
    cross join lateral (
      select project.id as raw_job_id,
             date_trunc('milliseconds', project.updated_at, 'UTC')
               as updated_sort_at
      from public.projects project
      where project.company_id = p_company_id
        and project.deleted_at is null
        and project.status = selector.status
      order by date_trunc(
          'milliseconds', project.updated_at, 'UTC'
        ) desc nulls last,
        project.id
      limit 501
    ) selected
    order by selected.updated_sort_at desc nulls last,
      selected.raw_job_id
    limit 501
  ), project_filter_updated_no_window_invalid_candidate as materialized (
    select project.id as raw_job_id,
           date_trunc('milliseconds', project.updated_at, 'UTC')
             as updated_sort_at
    from public.projects project
    where p_query is null
      and p_date_field is null
      and 'project' = any(p_job_kinds)
      and project.company_id = p_company_id
      and project.deleted_at is null
      and (project.status is null or project.status not in (
        'rfq', 'estimated', 'accepted', 'in_progress', 'completed',
        'closed', 'archived'
      ))
    order by date_trunc(
        'milliseconds', project.updated_at, 'UTC'
      ) desc nulls last,
      project.id
    limit 501
  ), project_filter_updated_no_window_keyset as materialized (
    select candidate.*
    from (
      select selected.*
      from project_filter_updated_no_window_selected_candidate selected
      union all
      select invalid.*
      from project_filter_updated_no_window_invalid_candidate invalid
    ) candidate
    order by candidate.updated_sort_at desc nulls last,
      candidate.raw_job_id
    limit 501
  ), project_filter_updated_window_source as not materialized (
    select candidate.*
    from project_inspection_source candidate
    where p_query is null
      and p_date_field = 'updated_at'
      and candidate.updated_sort_at >= p_date_from
      and candidate.updated_sort_at < p_date_to_exclusive
  ), opportunity_title_literal_keyset as materialized (
    select opportunity.id as raw_job_id
    from authority_context context
    join public.opportunities opportunity
      on opportunity.company_id = p_company_id
     and opportunity.deleted_at is null
     and opportunity.merged_into_opportunity_id is null
    where p_query is not null
      and 'opportunity' = any(p_job_kinds)
      and 'title' = any(p_query_fields)
      and left(
        private.agent_normalize_discovery_text(opportunity.title), 200
      ) collate "C" >=
        p_query collate "C"
      and left(
        private.agent_normalize_discovery_text(opportunity.title), 200
      ) collate "C" <
        private.agent_discovery_prefix_upper_bound(p_query) collate "C"
      and case when opportunity.stage is null
        or opportunity.stage not in (
          'new_lead', 'qualifying', 'quoting', 'quoted', 'follow_up',
          'negotiation', 'won', 'lost', 'discarded'
        ) then '__invalid__' else opportunity.stage end = any(
          array_append(coalesce(p_opportunity_stages, array[
            'new_lead', 'qualifying', 'quoting', 'quoted', 'follow_up',
            'negotiation', 'won', 'lost', 'discarded'
          ]::text[]), '__invalid__')
        )
      and case when opportunity.stage is null
        or opportunity.stage not in (
          'new_lead', 'qualifying', 'quoting', 'quoted', 'follow_up',
          'negotiation', 'won', 'lost', 'discarded'
        ) then '__invalid__'
        when opportunity.archived_at is not null
          or opportunity.stage = 'discarded' then 'archived'
        when opportunity.stage in ('won', 'lost') then 'terminal'
        else 'active' end = any(array_append(
          coalesce(p_lifecycle_states, array[
            'active', 'terminal', 'archived'
          ]::text[]),
          '__invalid__'
        ))
      and (p_date_from is null
        or p_date_field = 'created_at' and date_trunc(
          'milliseconds', opportunity.created_at, 'UTC'
        ) >= p_date_from
        or p_date_field = 'updated_at' and date_trunc(
          'milliseconds', opportunity.updated_at, 'UTC'
        ) >= p_date_from)
      and (p_date_to_exclusive is null
        or p_date_field = 'created_at' and date_trunc(
          'milliseconds', opportunity.created_at, 'UTC'
        ) < p_date_to_exclusive
        or p_date_field = 'updated_at' and date_trunc(
          'milliseconds', opportunity.updated_at, 'UTC'
        ) < p_date_to_exclusive)
    order by left(
        private.agent_normalize_discovery_text(opportunity.title), 200
      ) collate "C",
      opportunity.id
    limit 501
  ), opportunity_title_literal_keyset_bound as materialized (
    select count(*) = 501 as query_bound
    from opportunity_title_literal_keyset
  ), opportunity_address_literal_keyset as materialized (
    select opportunity.id as raw_job_id
    from authority_context context
    join public.opportunities opportunity
      on opportunity.company_id = p_company_id
     and opportunity.deleted_at is null
     and opportunity.merged_into_opportunity_id is null
    where p_query is not null
      and 'opportunity' = any(p_job_kinds)
      and 'address' = any(p_query_fields)
      and left(
        private.agent_normalize_discovery_text(opportunity.address), 200
      ) collate "C" >=
        p_query collate "C"
      and left(
        private.agent_normalize_discovery_text(opportunity.address), 200
      ) collate "C" <
        private.agent_discovery_prefix_upper_bound(p_query) collate "C"
      and case when opportunity.stage is null
        or opportunity.stage not in (
          'new_lead', 'qualifying', 'quoting', 'quoted', 'follow_up',
          'negotiation', 'won', 'lost', 'discarded'
        ) then '__invalid__' else opportunity.stage end = any(
          array_append(coalesce(p_opportunity_stages, array[
            'new_lead', 'qualifying', 'quoting', 'quoted', 'follow_up',
            'negotiation', 'won', 'lost', 'discarded'
          ]::text[]), '__invalid__')
        )
      and case when opportunity.stage is null
        or opportunity.stage not in (
          'new_lead', 'qualifying', 'quoting', 'quoted', 'follow_up',
          'negotiation', 'won', 'lost', 'discarded'
        ) then '__invalid__'
        when opportunity.archived_at is not null
          or opportunity.stage = 'discarded' then 'archived'
        when opportunity.stage in ('won', 'lost') then 'terminal'
        else 'active' end = any(array_append(
          coalesce(p_lifecycle_states, array[
            'active', 'terminal', 'archived'
          ]::text[]),
          '__invalid__'
        ))
      and (p_date_from is null
        or p_date_field = 'created_at' and date_trunc(
          'milliseconds', opportunity.created_at, 'UTC'
        ) >= p_date_from
        or p_date_field = 'updated_at' and date_trunc(
          'milliseconds', opportunity.updated_at, 'UTC'
        ) >= p_date_from)
      and (p_date_to_exclusive is null
        or p_date_field = 'created_at' and date_trunc(
          'milliseconds', opportunity.created_at, 'UTC'
        ) < p_date_to_exclusive
        or p_date_field = 'updated_at' and date_trunc(
          'milliseconds', opportunity.updated_at, 'UTC'
        ) < p_date_to_exclusive)
    order by left(
        private.agent_normalize_discovery_text(opportunity.address), 200
      ) collate "C",
      opportunity.id
    limit 501
  ), opportunity_address_literal_keyset_bound as materialized (
    select count(*) = 501 as query_bound
    from opportunity_address_literal_keyset
  ), opportunity_exact_title_gate as materialized (
    select candidate.*, 'exact_title'::text as match_kind,
           'title'::text as match_field, 1::integer as match_tier,
           0::integer as field_rank,
           candidate.normalized_title as match_value
    from opportunity_title_literal_keyset_bound bound
    join opportunity_title_literal_keyset keyset on not bound.query_bound
    cross join lateral (
      select source_candidate.*
      from opportunity_query_source source_candidate
      where source_candidate.raw_job_id = keyset.raw_job_id
      limit 1
    ) candidate
    where p_query is not null
      and 'title' = any(p_query_fields)
      and candidate.normalized_title = p_query
      and left(candidate.normalized_title, 200) = p_query
    order by left(candidate.normalized_title, 200) collate "C",
      candidate.raw_job_id
    limit 501
  ), opportunity_exact_address_gate as materialized (
    select candidate.*, 'exact_address'::text as match_kind,
           'address'::text as match_field, 1::integer as match_tier,
           1::integer as field_rank,
           candidate.normalized_address as match_value
    from opportunity_address_literal_keyset_bound bound
    join opportunity_address_literal_keyset keyset on not bound.query_bound
    cross join lateral (
      select source_candidate.*
      from opportunity_query_source source_candidate
      where source_candidate.raw_job_id = keyset.raw_job_id
      limit 1
    ) candidate
    where p_query is not null
      and 'address' = any(p_query_fields)
      and candidate.normalized_address = p_query
      and left(candidate.normalized_address, 200) = p_query
      and ('title' = any(p_query_fields)
        and candidate.normalized_title = p_query) is not true
    order by left(candidate.normalized_address, 200) collate "C",
      candidate.raw_job_id
    limit 501
  ), opportunity_prefix_title_gate as materialized (
    select candidate.*, 'prefix_title'::text as match_kind,
           'title'::text as match_field, 2::integer as match_tier,
           0::integer as field_rank,
           candidate.normalized_title as match_value
    from opportunity_title_literal_keyset_bound bound
    join opportunity_title_literal_keyset keyset on not bound.query_bound
    cross join lateral (
      select source_candidate.*
      from opportunity_query_source source_candidate
      where source_candidate.raw_job_id = keyset.raw_job_id
      limit 1
    ) candidate
    where p_query is not null
      and 'title' = any(p_query_fields)
      and candidate.normalized_title is distinct from p_query
      and candidate.normalized_title like
        private.agent_escape_like_literal(p_query) || '%' escape '\'
      and left(candidate.normalized_title, 200) like
        private.agent_escape_like_literal(p_query) || '%' escape '\'
      and ('address' = any(p_query_fields)
        and candidate.normalized_address = p_query) is not true
    order by left(candidate.normalized_title, 200) collate "C",
      candidate.raw_job_id
    limit 501
  ), opportunity_prefix_address_gate as materialized (
    select candidate.*, 'prefix_address'::text as match_kind,
           'address'::text as match_field, 2::integer as match_tier,
           1::integer as field_rank,
           candidate.normalized_address as match_value
    from opportunity_address_literal_keyset_bound bound
    join opportunity_address_literal_keyset keyset on not bound.query_bound
    cross join lateral (
      select source_candidate.*
      from opportunity_query_source source_candidate
      where source_candidate.raw_job_id = keyset.raw_job_id
      limit 1
    ) candidate
    where p_query is not null
      and 'address' = any(p_query_fields)
      and candidate.normalized_address is distinct from p_query
      and candidate.normalized_address like
        private.agent_escape_like_literal(p_query) || '%' escape '\'
      and left(candidate.normalized_address, 200) like
        private.agent_escape_like_literal(p_query) || '%' escape '\'
      and ('title' = any(p_query_fields) and (
        candidate.normalized_title = p_query
        or candidate.normalized_title like
          private.agent_escape_like_literal(p_query) || '%' escape '\'
      )) is not true
    order by left(candidate.normalized_address, 200) collate "C",
      candidate.raw_job_id
    limit 501
  ), opportunity_all_tokens_title_gate as materialized (
    select candidate.*, 'all_tokens_title'::text as match_kind,
           'title'::text as match_field, 3::integer as match_tier,
           0::integer as field_rank,
           candidate.normalized_title as match_value
    from query_tokens tokens
    cross join opportunity_query_source candidate
    where not (
        select query_bound from opportunity_title_literal_keyset_bound
      )
      and not (
        select query_bound from opportunity_address_literal_keyset_bound
      )
      and (select count(*) from opportunity_exact_title_gate) +
        (select count(*) from opportunity_exact_address_gate) +
        (select count(*) from opportunity_prefix_title_gate) +
        (select count(*) from opportunity_prefix_address_gate) < 501
      and 'title' = any(p_query_fields)
      and not exists (
        select 1 from unnest(tokens.values) short_token(value)
        where char_length(short_token.value) < 3
      )
      and ('title' = any(p_query_fields)
        and candidate.normalized_title = p_query) is not true
      and ('address' = any(p_query_fields)
        and candidate.normalized_address = p_query) is not true
      and ('title' = any(p_query_fields)
        and candidate.normalized_title like
          private.agent_escape_like_literal(p_query) || '%' escape '\'
      ) is not true
      and ('address' = any(p_query_fields)
        and candidate.normalized_address like
          private.agent_escape_like_literal(p_query) || '%' escape '\'
      ) is not true
      and candidate.normalized_title like '%' || private.agent_escape_like_literal(
        tokens.values[1]
      ) || '%' escape '\'
      and candidate.normalized_title like '%' || private.agent_escape_like_literal(
        coalesce(tokens.values[2], tokens.values[1])
      ) || '%' escape '\'
      and candidate.normalized_title like '%' || private.agent_escape_like_literal(
        coalesce(tokens.values[3], tokens.values[1])
      ) || '%' escape '\'
      and candidate.normalized_title like '%' || private.agent_escape_like_literal(
        coalesce(tokens.values[4], tokens.values[1])
      ) || '%' escape '\'
      and candidate.normalized_title like '%' || private.agent_escape_like_literal(
        coalesce(tokens.values[5], tokens.values[1])
      ) || '%' escape '\'
      and candidate.normalized_title like '%' || private.agent_escape_like_literal(
        coalesce(tokens.values[6], tokens.values[1])
      ) || '%' escape '\'
      and candidate.normalized_title like '%' || private.agent_escape_like_literal(
        coalesce(tokens.values[7], tokens.values[1])
      ) || '%' escape '\'
      and candidate.normalized_title like '%' || private.agent_escape_like_literal(
        coalesce(tokens.values[8], tokens.values[1])
      ) || '%' escape '\'
    order by candidate.normalized_title collate "C",
      candidate.raw_job_id
    limit 501
  ), opportunity_all_tokens_address_gate as materialized (
    select candidate.*, 'all_tokens_address'::text as match_kind,
           'address'::text as match_field, 3::integer as match_tier,
           1::integer as field_rank,
           candidate.normalized_address as match_value
    from query_tokens tokens
    cross join opportunity_query_source candidate
    where not (
        select query_bound from opportunity_title_literal_keyset_bound
      )
      and not (
        select query_bound from opportunity_address_literal_keyset_bound
      )
      and (select count(*) from opportunity_all_tokens_title_gate) +
        (select count(*) from opportunity_exact_title_gate) +
        (select count(*) from opportunity_exact_address_gate) +
        (select count(*) from opportunity_prefix_title_gate) +
        (select count(*) from opportunity_prefix_address_gate) < 501
      and 'address' = any(p_query_fields)
      and not exists (
        select 1 from unnest(tokens.values) short_token(value)
        where char_length(short_token.value) < 3
      )
      and ('title' = any(p_query_fields)
        and candidate.normalized_title = p_query) is not true
      and ('address' = any(p_query_fields)
        and candidate.normalized_address = p_query) is not true
      and ('title' = any(p_query_fields)
        and candidate.normalized_title like
          private.agent_escape_like_literal(p_query) || '%' escape '\'
      ) is not true
      and ('address' = any(p_query_fields)
        and candidate.normalized_address like
          private.agent_escape_like_literal(p_query) || '%' escape '\'
      ) is not true
      and not exists (
        select 1 from opportunity_all_tokens_title_gate title_match
        where title_match.raw_job_id = candidate.raw_job_id
      )
      and candidate.normalized_address like '%' || private.agent_escape_like_literal(
        tokens.values[1]
      ) || '%' escape '\'
      and candidate.normalized_address like '%' || private.agent_escape_like_literal(
        coalesce(tokens.values[2], tokens.values[1])
      ) || '%' escape '\'
      and candidate.normalized_address like '%' || private.agent_escape_like_literal(
        coalesce(tokens.values[3], tokens.values[1])
      ) || '%' escape '\'
      and candidate.normalized_address like '%' || private.agent_escape_like_literal(
        coalesce(tokens.values[4], tokens.values[1])
      ) || '%' escape '\'
      and candidate.normalized_address like '%' || private.agent_escape_like_literal(
        coalesce(tokens.values[5], tokens.values[1])
      ) || '%' escape '\'
      and candidate.normalized_address like '%' || private.agent_escape_like_literal(
        coalesce(tokens.values[6], tokens.values[1])
      ) || '%' escape '\'
      and candidate.normalized_address like '%' || private.agent_escape_like_literal(
        coalesce(tokens.values[7], tokens.values[1])
      ) || '%' escape '\'
      and candidate.normalized_address like '%' || private.agent_escape_like_literal(
        coalesce(tokens.values[8], tokens.values[1])
      ) || '%' escape '\'
    order by candidate.normalized_address collate "C",
      candidate.raw_job_id
    limit 501
  ), opportunity_query_candidate as not materialized (
    select candidate.* from opportunity_exact_title_gate candidate
    union all
    select candidate.* from opportunity_exact_address_gate candidate
    union all
    select candidate.* from opportunity_prefix_title_gate candidate
    union all
    select candidate.* from opportunity_prefix_address_gate candidate
    union all
    select candidate.* from opportunity_all_tokens_title_gate candidate
    union all
    select candidate.* from opportunity_all_tokens_address_gate candidate
  ), opportunity_query_gate as materialized (
    select candidate.*
    from opportunity_query_candidate candidate
    order by candidate.match_tier,
      candidate.field_rank,
      candidate.raw_job_kind,
      candidate.match_value collate "C",
      candidate.raw_job_id
    limit 501
  ), opportunity_filter_created_gate as materialized (
    select candidate.*, 'filter_only'::text as match_kind,
           'none'::text as match_field, 0::integer as match_tier,
           0::integer as field_rank, ''::text as match_value
    from opportunity_filter_created_source candidate
    where p_query is null
      and p_date_field = 'created_at'
    order by candidate.created_sort_at desc nulls last,
      candidate.raw_job_id
    limit 501
  ), opportunity_filter_updated_no_window_gate as materialized (
    select candidate.*, 'filter_only'::text as match_kind,
           'none'::text as match_field, 0::integer as match_tier,
           0::integer as field_rank, ''::text as match_value
    from opportunity_filter_updated_no_window_keyset keyset
    cross join lateral (
      select source_candidate.*
      from opportunity_filter_updated_no_window_source source_candidate
      where source_candidate.raw_job_id = keyset.raw_job_id
      limit 1
    ) candidate
    order by keyset.updated_sort_at desc nulls last,
      keyset.raw_job_id
    limit 501
  ), opportunity_filter_updated_window_gate as materialized (
    select candidate.*, 'filter_only'::text as match_kind,
           'none'::text as match_field, 0::integer as match_tier,
           0::integer as field_rank, ''::text as match_value
    from opportunity_filter_updated_window_source candidate
    where p_query is null
      and p_date_field = 'updated_at'
    order by candidate.updated_sort_at desc nulls last,
      candidate.raw_job_id
    limit 501
  ), opportunity_filter_updated_gate as materialized (
    select no_window_candidate.*
    from opportunity_filter_updated_no_window_gate no_window_candidate
    union all
    select window_candidate.*
    from opportunity_filter_updated_window_gate window_candidate
    order by updated_sort_at desc nulls last, raw_job_id
    limit 501
  ), opportunity_primary_candidate as not materialized (
    select query_candidate.*
    from opportunity_query_gate query_candidate
    union all
    select created_candidate.*
    from opportunity_filter_created_gate created_candidate
    union all
    select updated_candidate.*
    from opportunity_filter_updated_gate updated_candidate
  ), opportunity_primary_gate as materialized (
    select candidate.*,
           candidate.selection_anchor_base || jsonb_build_object(
             'match_basis', case candidate.match_kind
               when 'filter_only' then jsonb_build_object(
                 'ranking_revision', p_ranking_revision,
                 'kind', 'filter_only', 'field', 'none'
               )
               else jsonb_build_object(
                 'ranking_revision', p_ranking_revision,
                 'kind', candidate.match_kind,
                 'field', candidate.match_field
               )
             end
           ) as selection_anchor
    from opportunity_primary_candidate candidate
    order by
      case when p_query is null then candidate.sort_at end desc nulls last,
      case when p_query is not null then candidate.match_tier end,
      case when p_query is not null then candidate.field_rank end,
      candidate.raw_job_kind,
      case when p_query is not null
        then candidate.match_value collate "C" end,
      candidate.raw_job_id
    limit 501
  ), project_title_literal_keyset as materialized (
    select project.id as raw_job_id
    from authority_context context
    join public.projects project
      on project.company_id = p_company_id
     and project.deleted_at is null
    where p_query is not null
      and 'project' = any(p_job_kinds)
      and 'title' = any(p_query_fields)
      and left(
        private.agent_normalize_discovery_text(project.title), 200
      ) collate "C" >=
        p_query collate "C"
      and left(
        private.agent_normalize_discovery_text(project.title), 200
      ) collate "C" <
        private.agent_discovery_prefix_upper_bound(p_query) collate "C"
      and case when project.status is null or project.status not in (
        'rfq', 'estimated', 'accepted', 'in_progress', 'completed',
        'closed', 'archived'
      ) then '__invalid__' else project.status end = any(array_append(
        coalesce(p_project_statuses, array[
          'rfq', 'estimated', 'accepted', 'in_progress', 'completed',
          'closed', 'archived'
        ]::text[]),
        '__invalid__'
      ))
      and case when project.status is null or project.status not in (
        'rfq', 'estimated', 'accepted', 'in_progress', 'completed',
        'closed', 'archived'
      ) then '__invalid__'
        when project.status = 'archived' then 'archived'
        when project.status in ('completed', 'closed') then 'terminal'
        else 'active' end = any(array_append(
          coalesce(p_lifecycle_states, array[
            'active', 'terminal', 'archived'
          ]::text[]),
          '__invalid__'
        ))
      and (p_date_from is null
        or p_date_field = 'created_at' and date_trunc(
          'milliseconds', project.created_at, 'UTC'
        ) >= p_date_from
        or p_date_field = 'updated_at' and date_trunc(
          'milliseconds', project.updated_at, 'UTC'
        ) >= p_date_from)
      and (p_date_to_exclusive is null
        or p_date_field = 'created_at' and date_trunc(
          'milliseconds', project.created_at, 'UTC'
        ) < p_date_to_exclusive
        or p_date_field = 'updated_at' and date_trunc(
          'milliseconds', project.updated_at, 'UTC'
        ) < p_date_to_exclusive)
    order by left(
        private.agent_normalize_discovery_text(project.title), 200
      ) collate "C",
      project.id
    limit 501
  ), project_title_literal_keyset_bound as materialized (
    select count(*) = 501 as query_bound
    from project_title_literal_keyset
  ), project_address_literal_keyset as materialized (
    select project.id as raw_job_id
    from authority_context context
    join public.projects project
      on project.company_id = p_company_id
     and project.deleted_at is null
    where p_query is not null
      and 'project' = any(p_job_kinds)
      and 'address' = any(p_query_fields)
      and left(
        private.agent_normalize_discovery_text(project.address), 200
      ) collate "C" >=
        p_query collate "C"
      and left(
        private.agent_normalize_discovery_text(project.address), 200
      ) collate "C" <
        private.agent_discovery_prefix_upper_bound(p_query) collate "C"
      and case when project.status is null or project.status not in (
        'rfq', 'estimated', 'accepted', 'in_progress', 'completed',
        'closed', 'archived'
      ) then '__invalid__' else project.status end = any(array_append(
        coalesce(p_project_statuses, array[
          'rfq', 'estimated', 'accepted', 'in_progress', 'completed',
          'closed', 'archived'
        ]::text[]),
        '__invalid__'
      ))
      and case when project.status is null or project.status not in (
        'rfq', 'estimated', 'accepted', 'in_progress', 'completed',
        'closed', 'archived'
      ) then '__invalid__'
        when project.status = 'archived' then 'archived'
        when project.status in ('completed', 'closed') then 'terminal'
        else 'active' end = any(array_append(
          coalesce(p_lifecycle_states, array[
            'active', 'terminal', 'archived'
          ]::text[]),
          '__invalid__'
        ))
      and (p_date_from is null
        or p_date_field = 'created_at' and date_trunc(
          'milliseconds', project.created_at, 'UTC'
        ) >= p_date_from
        or p_date_field = 'updated_at' and date_trunc(
          'milliseconds', project.updated_at, 'UTC'
        ) >= p_date_from)
      and (p_date_to_exclusive is null
        or p_date_field = 'created_at' and date_trunc(
          'milliseconds', project.created_at, 'UTC'
        ) < p_date_to_exclusive
        or p_date_field = 'updated_at' and date_trunc(
          'milliseconds', project.updated_at, 'UTC'
        ) < p_date_to_exclusive)
    order by left(
        private.agent_normalize_discovery_text(project.address), 200
      ) collate "C",
      project.id
    limit 501
  ), project_address_literal_keyset_bound as materialized (
    select count(*) = 501 as query_bound
    from project_address_literal_keyset
  ), project_exact_title_gate as materialized (
    select candidate.*, 'exact_title'::text as match_kind,
           'title'::text as match_field, 1::integer as match_tier,
           0::integer as field_rank,
           candidate.normalized_title as match_value
    from project_title_literal_keyset_bound bound
    join project_title_literal_keyset keyset on not bound.query_bound
    cross join lateral (
      select source_candidate.*
      from project_query_source source_candidate
      where source_candidate.raw_job_id = keyset.raw_job_id
      limit 1
    ) candidate
    where p_query is not null
      and 'title' = any(p_query_fields)
      and candidate.normalized_title = p_query
      and left(candidate.normalized_title, 200) = p_query
    order by left(candidate.normalized_title, 200) collate "C",
      candidate.raw_job_id
    limit 501
  ), project_exact_address_gate as materialized (
    select candidate.*, 'exact_address'::text as match_kind,
           'address'::text as match_field, 1::integer as match_tier,
           1::integer as field_rank,
           candidate.normalized_address as match_value
    from project_address_literal_keyset_bound bound
    join project_address_literal_keyset keyset on not bound.query_bound
    cross join lateral (
      select source_candidate.*
      from project_query_source source_candidate
      where source_candidate.raw_job_id = keyset.raw_job_id
      limit 1
    ) candidate
    where p_query is not null
      and 'address' = any(p_query_fields)
      and candidate.normalized_address = p_query
      and left(candidate.normalized_address, 200) = p_query
      and ('title' = any(p_query_fields)
        and candidate.normalized_title = p_query) is not true
    order by left(candidate.normalized_address, 200) collate "C",
      candidate.raw_job_id
    limit 501
  ), project_prefix_title_gate as materialized (
    select candidate.*, 'prefix_title'::text as match_kind,
           'title'::text as match_field, 2::integer as match_tier,
           0::integer as field_rank,
           candidate.normalized_title as match_value
    from project_title_literal_keyset_bound bound
    join project_title_literal_keyset keyset on not bound.query_bound
    cross join lateral (
      select source_candidate.*
      from project_query_source source_candidate
      where source_candidate.raw_job_id = keyset.raw_job_id
      limit 1
    ) candidate
    where p_query is not null
      and 'title' = any(p_query_fields)
      and candidate.normalized_title is distinct from p_query
      and candidate.normalized_title like
        private.agent_escape_like_literal(p_query) || '%' escape '\'
      and left(candidate.normalized_title, 200) like
        private.agent_escape_like_literal(p_query) || '%' escape '\'
      and ('address' = any(p_query_fields)
        and candidate.normalized_address = p_query) is not true
    order by left(candidate.normalized_title, 200) collate "C",
      candidate.raw_job_id
    limit 501
  ), project_prefix_address_gate as materialized (
    select candidate.*, 'prefix_address'::text as match_kind,
           'address'::text as match_field, 2::integer as match_tier,
           1::integer as field_rank,
           candidate.normalized_address as match_value
    from project_address_literal_keyset_bound bound
    join project_address_literal_keyset keyset on not bound.query_bound
    cross join lateral (
      select source_candidate.*
      from project_query_source source_candidate
      where source_candidate.raw_job_id = keyset.raw_job_id
      limit 1
    ) candidate
    where p_query is not null
      and 'address' = any(p_query_fields)
      and candidate.normalized_address is distinct from p_query
      and candidate.normalized_address like
        private.agent_escape_like_literal(p_query) || '%' escape '\'
      and left(candidate.normalized_address, 200) like
        private.agent_escape_like_literal(p_query) || '%' escape '\'
      and ('title' = any(p_query_fields) and (
        candidate.normalized_title = p_query
        or candidate.normalized_title like
          private.agent_escape_like_literal(p_query) || '%' escape '\'
      )) is not true
    order by left(candidate.normalized_address, 200) collate "C",
      candidate.raw_job_id
    limit 501
  ), project_all_tokens_title_gate as materialized (
    select candidate.*, 'all_tokens_title'::text as match_kind,
           'title'::text as match_field, 3::integer as match_tier,
           0::integer as field_rank,
           candidate.normalized_title as match_value
    from query_tokens tokens
    cross join project_query_source candidate
    where not (select query_bound from project_title_literal_keyset_bound)
      and not (select query_bound from project_address_literal_keyset_bound)
      and (select count(*) from project_exact_title_gate) +
        (select count(*) from project_exact_address_gate) +
        (select count(*) from project_prefix_title_gate) +
        (select count(*) from project_prefix_address_gate) < 501
      and 'title' = any(p_query_fields)
      and not exists (
        select 1 from unnest(tokens.values) short_token(value)
        where char_length(short_token.value) < 3
      )
      and ('title' = any(p_query_fields)
        and candidate.normalized_title = p_query) is not true
      and ('address' = any(p_query_fields)
        and candidate.normalized_address = p_query) is not true
      and ('title' = any(p_query_fields)
        and candidate.normalized_title like
          private.agent_escape_like_literal(p_query) || '%' escape '\'
      ) is not true
      and ('address' = any(p_query_fields)
        and candidate.normalized_address like
          private.agent_escape_like_literal(p_query) || '%' escape '\'
      ) is not true
      and candidate.normalized_title like '%' || private.agent_escape_like_literal(
        tokens.values[1]
      ) || '%' escape '\'
      and candidate.normalized_title like '%' || private.agent_escape_like_literal(
        coalesce(tokens.values[2], tokens.values[1])
      ) || '%' escape '\'
      and candidate.normalized_title like '%' || private.agent_escape_like_literal(
        coalesce(tokens.values[3], tokens.values[1])
      ) || '%' escape '\'
      and candidate.normalized_title like '%' || private.agent_escape_like_literal(
        coalesce(tokens.values[4], tokens.values[1])
      ) || '%' escape '\'
      and candidate.normalized_title like '%' || private.agent_escape_like_literal(
        coalesce(tokens.values[5], tokens.values[1])
      ) || '%' escape '\'
      and candidate.normalized_title like '%' || private.agent_escape_like_literal(
        coalesce(tokens.values[6], tokens.values[1])
      ) || '%' escape '\'
      and candidate.normalized_title like '%' || private.agent_escape_like_literal(
        coalesce(tokens.values[7], tokens.values[1])
      ) || '%' escape '\'
      and candidate.normalized_title like '%' || private.agent_escape_like_literal(
        coalesce(tokens.values[8], tokens.values[1])
      ) || '%' escape '\'
    order by candidate.normalized_title collate "C",
      candidate.raw_job_id
    limit 501
  ), project_all_tokens_address_gate as materialized (
    select candidate.*, 'all_tokens_address'::text as match_kind,
           'address'::text as match_field, 3::integer as match_tier,
           1::integer as field_rank,
           candidate.normalized_address as match_value
    from query_tokens tokens
    cross join project_query_source candidate
    where not (select query_bound from project_title_literal_keyset_bound)
      and not (select query_bound from project_address_literal_keyset_bound)
      and (select count(*) from project_all_tokens_title_gate) +
        (select count(*) from project_exact_title_gate) +
        (select count(*) from project_exact_address_gate) +
        (select count(*) from project_prefix_title_gate) +
        (select count(*) from project_prefix_address_gate) < 501
      and 'address' = any(p_query_fields)
      and not exists (
        select 1 from unnest(tokens.values) short_token(value)
        where char_length(short_token.value) < 3
      )
      and ('title' = any(p_query_fields)
        and candidate.normalized_title = p_query) is not true
      and ('address' = any(p_query_fields)
        and candidate.normalized_address = p_query) is not true
      and ('title' = any(p_query_fields)
        and candidate.normalized_title like
          private.agent_escape_like_literal(p_query) || '%' escape '\'
      ) is not true
      and ('address' = any(p_query_fields)
        and candidate.normalized_address like
          private.agent_escape_like_literal(p_query) || '%' escape '\'
      ) is not true
      and not exists (
        select 1 from project_all_tokens_title_gate title_match
        where title_match.raw_job_id = candidate.raw_job_id
      )
      and candidate.normalized_address like '%' || private.agent_escape_like_literal(
        tokens.values[1]
      ) || '%' escape '\'
      and candidate.normalized_address like '%' || private.agent_escape_like_literal(
        coalesce(tokens.values[2], tokens.values[1])
      ) || '%' escape '\'
      and candidate.normalized_address like '%' || private.agent_escape_like_literal(
        coalesce(tokens.values[3], tokens.values[1])
      ) || '%' escape '\'
      and candidate.normalized_address like '%' || private.agent_escape_like_literal(
        coalesce(tokens.values[4], tokens.values[1])
      ) || '%' escape '\'
      and candidate.normalized_address like '%' || private.agent_escape_like_literal(
        coalesce(tokens.values[5], tokens.values[1])
      ) || '%' escape '\'
      and candidate.normalized_address like '%' || private.agent_escape_like_literal(
        coalesce(tokens.values[6], tokens.values[1])
      ) || '%' escape '\'
      and candidate.normalized_address like '%' || private.agent_escape_like_literal(
        coalesce(tokens.values[7], tokens.values[1])
      ) || '%' escape '\'
      and candidate.normalized_address like '%' || private.agent_escape_like_literal(
        coalesce(tokens.values[8], tokens.values[1])
      ) || '%' escape '\'
    order by candidate.normalized_address collate "C",
      candidate.raw_job_id
    limit 501
  ), project_query_candidate as not materialized (
    select candidate.* from project_exact_title_gate candidate
    union all
    select candidate.* from project_exact_address_gate candidate
    union all
    select candidate.* from project_prefix_title_gate candidate
    union all
    select candidate.* from project_prefix_address_gate candidate
    union all
    select candidate.* from project_all_tokens_title_gate candidate
    union all
    select candidate.* from project_all_tokens_address_gate candidate
  ), project_query_gate as materialized (
    select candidate.*
    from project_query_candidate candidate
    order by candidate.match_tier,
      candidate.field_rank,
      candidate.raw_job_kind,
      candidate.match_value collate "C",
      candidate.raw_job_id
    limit 501
  ), project_filter_created_gate as materialized (
    select candidate.*, 'filter_only'::text as match_kind,
           'none'::text as match_field, 0::integer as match_tier,
           0::integer as field_rank, ''::text as match_value
    from project_filter_created_source candidate
    where p_query is null
      and p_date_field = 'created_at'
    order by candidate.created_sort_at desc nulls last,
      candidate.raw_job_id
    limit 501
  ), project_filter_updated_no_window_gate as materialized (
    select candidate.*, 'filter_only'::text as match_kind,
           'none'::text as match_field, 0::integer as match_tier,
           0::integer as field_rank, ''::text as match_value
    from project_filter_updated_no_window_keyset keyset
    cross join lateral (
      select source_candidate.*
      from project_filter_updated_no_window_source source_candidate
      where source_candidate.raw_job_id = keyset.raw_job_id
      limit 1
    ) candidate
    order by keyset.updated_sort_at desc nulls last,
      keyset.raw_job_id
    limit 501
  ), project_filter_updated_window_gate as materialized (
    select candidate.*, 'filter_only'::text as match_kind,
           'none'::text as match_field, 0::integer as match_tier,
           0::integer as field_rank, ''::text as match_value
    from project_filter_updated_window_source candidate
    where p_query is null
      and p_date_field = 'updated_at'
    order by candidate.updated_sort_at desc nulls last,
      candidate.raw_job_id
    limit 501
  ), project_filter_updated_gate as materialized (
    select no_window_candidate.*
    from project_filter_updated_no_window_gate no_window_candidate
    union all
    select window_candidate.*
    from project_filter_updated_window_gate window_candidate
    order by updated_sort_at desc nulls last, raw_job_id
    limit 501
  ), project_primary_candidate as not materialized (
    select query_candidate.*
    from project_query_gate query_candidate
    union all
    select created_candidate.*
    from project_filter_created_gate created_candidate
    union all
    select updated_candidate.*
    from project_filter_updated_gate updated_candidate
  ), project_primary_gate as materialized (
    select candidate.*,
           candidate.selection_anchor_base || jsonb_build_object(
             'match_basis', case candidate.match_kind
               when 'filter_only' then jsonb_build_object(
                 'ranking_revision', p_ranking_revision,
                 'kind', 'filter_only', 'field', 'none'
               )
               else jsonb_build_object(
                 'ranking_revision', p_ranking_revision,
                 'kind', candidate.match_kind,
                 'field', candidate.match_field
               )
             end
           ) as selection_anchor
    from project_primary_candidate candidate
    order by
      case when p_query is null then candidate.sort_at end desc nulls last,
      case when p_query is not null then candidate.match_tier end,
      case when p_query is not null then candidate.field_rank end,
      candidate.raw_job_kind,
      case when p_query is not null
        then candidate.match_value collate "C" end,
      candidate.raw_job_id
    limit 501
  ), inspection_state as materialized (
    select (select query_bound
              from opportunity_title_literal_keyset_bound)
             or (select query_bound
                   from opportunity_address_literal_keyset_bound)
             or (select query_bound
                   from project_title_literal_keyset_bound)
             or (select query_bound
                   from project_address_literal_keyset_bound)
             or (select count(*) from opportunity_primary_gate) = 501
             or (select count(*) from project_primary_gate) = 501
             as query_bound
  ), opportunity_authorized_gate as materialized (
    select candidate.*
    from inspection_state state
    join opportunity_primary_gate candidate on not state.query_bound
    where (
        p_pipeline_scope = 'all'
        or p_pipeline_scope = 'assigned'
          and candidate.assigned_to = p_actor_user_id
      )
      and private.agent_user_can_access_entity(
        p_actor_user_id,
        p_company_id,
        'opportunity',
        candidate.raw_job_id,
        'view'
      )
  ), project_authorized_gate as materialized (
    select candidate.*
    from inspection_state state
    join project_primary_gate candidate on not state.query_bound
    where (
        p_projects_scope = 'all'
        or p_projects_scope = 'assigned' and (
          exists (
            select 1
            from public.project_tasks task
            where task.company_id = p_company_id
              and task.project_id = candidate.raw_job_id
              and task.deleted_at is null
              and task.team_member_ids @> array[p_actor_user_id::text]
          )
          or exists (
            select 1
            from public.project_notes note
            where private.agent_uuid_from_legacy_text(note.project_id) =
                  candidate.raw_job_id
              and note.deleted_at is null
              and note.mentioned_user_ids @> array[p_actor_user_id::text]
          )
        )
      )
      and private.agent_user_can_access_entity(
        p_actor_user_id,
        p_company_id,
        'project',
        candidate.raw_job_id,
        'view'
      )
  ), source_gate_state as materialized (
    select state.query_bound,
           not state.query_bound and (
             coalesce((
               select bool_or(candidate.source_data_invalid)
               from opportunity_authorized_gate candidate
             ), false)
             or coalesce((
               select bool_or(candidate.source_data_invalid)
               from project_authorized_gate candidate
             ), false)
           ) as source_data_invalid
    from inspection_state state
  ), paired_candidate as materialized (
    select case when project.raw_job_id is not null
             then 'project' else 'opportunity'
           end as canonical_job_kind,
           coalesce(project.raw_job_id, opportunity.raw_job_id)
             as canonical_job_id,
           opportunity.raw_job_kind,
           coalesce(project.title, opportunity.title) as title,
           coalesce(project.address, opportunity.address) as address,
           coalesce(project.status, opportunity.status) as status,
           coalesce(project.lifecycle_state, opportunity.lifecycle_state)
             as lifecycle_state,
           coalesce(project.created_at, opportunity.created_at) as created_at,
           coalesce(project.updated_at, opportunity.updated_at) as updated_at,
           project.start_date,
           project.end_date,
           coalesce(project.sort_at, opportunity.sort_at) as sort_at,
           coalesce(project.match_kind, opportunity.match_kind) as match_kind,
           coalesce(project.match_field, opportunity.match_field)
             as match_field,
           coalesce(project.match_tier, opportunity.match_tier) as match_tier,
           coalesce(project.field_rank, opportunity.field_rank) as field_rank,
           coalesce(project.match_value, opportunity.match_value) as match_value,
           case when project.raw_job_id is not null then
             jsonb_build_object(
               'anchors', jsonb_build_array(
                 opportunity.selection_anchor,
                 project.selection_anchor
               )
             )
           else jsonb_build_object(
             'anchors', jsonb_build_array(opportunity.selection_anchor)
           ) end as selection_witness,
           case
             when project.raw_job_id is not null then 'converted'
             when opportunity.linked_project_id is not null
               then 'linked_project_not_returned'
             else 'not_converted'
           end as conversion,
           opportunity.raw_job_id as opportunity_anchor_id,
           project.raw_job_id as project_anchor_id,
           opportunity.source_data_invalid
             or coalesce(project.source_data_invalid, false)
             as source_data_invalid
    from source_gate_state source_state
    join opportunity_authorized_gate opportunity
      on not source_state.query_bound
     and not source_state.source_data_invalid
    left join project_authorized_gate project
      on project.raw_job_id = opportunity.linked_project_id
     and project.linked_opportunity_id = opportunity.raw_job_id
     and project.client_id = opportunity.resolved_client_id

    union all

    select 'project',
           project.raw_job_id,
           project.raw_job_kind,
           project.title,
           project.address,
           project.status,
           project.lifecycle_state,
           project.created_at,
           project.updated_at,
           project.start_date,
           project.end_date,
           project.sort_at,
           project.match_kind,
           project.match_field,
           project.match_tier,
           project.field_rank,
           project.match_value,
           case when opportunity.raw_job_id is not null then
             jsonb_build_object(
               'anchors', jsonb_build_array(
                 opportunity.selection_anchor,
                 project.selection_anchor
               )
             )
           else jsonb_build_object(
             'anchors', jsonb_build_array(project.selection_anchor)
           ) end,
           case
             when opportunity.raw_job_id is not null then 'converted'
             when project.linked_opportunity_id is not null
               then 'linked_opportunity_not_returned'
             else 'standalone_project'
           end,
           opportunity.raw_job_id,
           project.raw_job_id,
           project.source_data_invalid
             or coalesce(opportunity.source_data_invalid, false)
    from source_gate_state source_state
    join project_authorized_gate project
      on not source_state.query_bound
     and not source_state.source_data_invalid
    left join opportunity_authorized_gate opportunity
      on opportunity.raw_job_id = project.linked_opportunity_id
     and opportunity.linked_project_id = project.raw_job_id
     and opportunity.resolved_client_id = project.client_id
  ), canonical_candidate as materialized (
    select paired.*,
           row_number() over (
             partition by paired.canonical_job_kind, paired.canonical_job_id
             order by case paired.raw_job_kind
               when 'project' then 0 else 1 end,
               paired.canonical_job_id
           ) as canonical_rank
    from paired_candidate paired
  ), authorized_candidate as (
    select canonical.canonical_job_kind as job_kind,
           canonical.canonical_job_id as job_id,
           canonical.title,
           canonical.address,
           canonical.status,
           canonical.lifecycle_state,
           canonical.created_at,
           canonical.updated_at,
           canonical.start_date,
           canonical.end_date,
           canonical.sort_at,
           canonical.match_kind,
           canonical.match_field,
           canonical.match_tier,
           canonical.field_rank,
           canonical.match_value,
           canonical.selection_witness,
           canonical.conversion,
           canonical.opportunity_anchor_id,
           canonical.project_anchor_id,
           canonical.source_data_invalid
    from canonical_candidate canonical
    where canonical.canonical_rank = 1
  ), candidate_gate as materialized (
    select candidate.*
    from authorized_candidate candidate
    order by
      case when p_query is null then candidate.sort_at end desc nulls last,
      case when p_query is not null then candidate.match_tier end,
      case when p_query is not null then candidate.field_rank end,
      candidate.job_kind,
      case when p_query is not null
        then candidate.match_value collate "C" end,
      candidate.job_id
    limit 501
  ), candidate_state as materialized (
    select case when source_state.query_bound then 501
             else count(candidate.job_id)::integer
           end as authorized_candidate_count,
           source_state.query_bound or count(candidate.job_id) = 501
             as query_bound,
           not (
             source_state.query_bound or count(candidate.job_id) = 501
           ) and (
             source_state.source_data_invalid or coalesce(
               bool_or(coalesce(candidate.source_data_invalid, true)) filter (
                 where candidate.job_id is not null
               ), false
             )
           ) as source_data_invalid
    from source_gate_state source_state
    left join candidate_gate candidate
      on not source_state.query_bound
     and not source_state.source_data_invalid
    group by source_state.query_bound, source_state.source_data_invalid
  ), ranked_candidate as materialized (
    select candidate.*,
           row_number() over (
             order by
               case when p_query is null then candidate.sort_at end desc
                 nulls last,
               case when p_query is not null then candidate.match_tier end,
               case when p_query is not null then candidate.field_rank end,
               candidate.job_kind,
               case when p_query is not null
                 then candidate.match_value collate "C" end,
               candidate.job_id
           )::integer as rank_ordinal
    from candidate_gate candidate
    where not candidate.source_data_invalid
    order by
      case when p_query is null then candidate.sort_at end desc nulls last,
      case when p_query is not null then candidate.match_tier end,
      case when p_query is not null then candidate.field_rank end,
      candidate.job_kind,
      case when p_query is not null
        then candidate.match_value collate "C" end,
      candidate.job_id
    limit 500
  ), ranked_raw_match as materialized (
    select ranked.*,
           'evidence:job_discovery_projection:' || ranked.job_kind || ':' ||
             ranked.job_id::text || ':ordinal:' ||
             ranked.rank_ordinal::text as evidence_id,
           jsonb_build_object(
             'job_ref', jsonb_build_object(
               'kind', ranked.job_kind, 'id', ranked.job_id
             ),
             'anchor_refs', case ranked.conversion
               when 'converted' then jsonb_build_array(
                 jsonb_build_object(
                   'kind', 'opportunity',
                   'id', ranked.opportunity_anchor_id
                 ),
                 jsonb_build_object(
                   'kind', 'project', 'id', ranked.project_anchor_id
                 )
               )
               else jsonb_build_array(jsonb_build_object(
                 'kind', ranked.job_kind, 'id', ranked.job_id
               )) end,
             'display_title', private.agent_trim_discovery_display_text(
               ranked.title
             ),
             'address', case when ranked.address is null then null
               else private.agent_trim_discovery_display_text(
                 ranked.address
               ) end,
             'lifecycle_state', ranked.lifecycle_state,
             'status', jsonb_build_object(
               'kind', ranked.job_kind, 'value', ranked.status
             ),
             'dates', case ranked.job_kind
               when 'project' then jsonb_build_object(
                 'kind', 'project',
                 'created_at', private.agent_rfc3339_utc(ranked.created_at),
                 'updated_at', private.agent_rfc3339_utc(ranked.updated_at),
                 'start_date', case when ranked.start_date is null then null
                   else to_char(
                     ranked.start_date at time zone 'UTC', 'YYYY-MM-DD'
                   ) end,
                 'end_date', case when ranked.end_date is null then null
                   else to_char(
                     ranked.end_date at time zone 'UTC', 'YYYY-MM-DD'
                   ) end
               )
               else jsonb_build_object(
                 'kind', 'opportunity',
                 'created_at', private.agent_rfc3339_utc(ranked.created_at),
                 'updated_at', private.agent_rfc3339_utc(ranked.updated_at)
               ) end,
             'conversion', case ranked.conversion
               when 'converted' then jsonb_build_object(
                 'state', 'converted',
                 'opportunity_ref', jsonb_build_object(
                   'kind', 'opportunity',
                   'id', ranked.opportunity_anchor_id
                 ),
                 'project_ref', jsonb_build_object(
                   'kind', 'project', 'id', ranked.project_anchor_id
                 )
               ) else jsonb_build_object('state', ranked.conversion) end,
             'match_basis', case ranked.match_kind
               when 'filter_only' then jsonb_build_object(
                 'ranking_revision', p_ranking_revision,
                 'kind', 'filter_only', 'field', 'none'
               )
               else jsonb_build_object(
                 'ranking_revision', p_ranking_revision,
                 'kind', ranked.match_kind,
                 'field', ranked.match_field
               ) end,
             'content_kind', 'untrusted_business_data',
             'visibility_reason', 'current_actor_authorized',
             'evidence_ids', jsonb_build_array(
               'evidence:job_discovery_projection:' || ranked.job_kind ||
                 ':' || ranked.job_id::text || ':ordinal:' ||
                 ranked.rank_ordinal::text
             )
           ) as raw
    from ranked_candidate ranked
  ), cursor_anchor as materialized (
    select p_cursor_rank_ordinal is null or exists (
      select 1
      from ranked_raw_match candidate
      where candidate.rank_ordinal = p_cursor_rank_ordinal
        and candidate.job_kind = p_cursor_job_kind
        and candidate.job_id = p_cursor_job_id
    ) as valid,
    case when p_cursor_rank_ordinal is null then null else (
      select jsonb_build_object(
        'rank_ordinal', candidate.rank_ordinal,
        'raw', candidate.raw
      )
      from ranked_raw_match candidate
      where candidate.rank_ordinal = p_cursor_rank_ordinal
        and candidate.job_kind = p_cursor_job_kind
        and candidate.job_id = p_cursor_job_id
    ) end as order_witness
  ), page_plus_one as materialized (
    select candidate.*
    from ranked_raw_match candidate
    cross join candidate_state state
    cross join cursor_anchor cursor_state
    where not state.query_bound
      and not state.source_data_invalid
      and cursor_state.valid
      and candidate.rank_ordinal > coalesce(p_cursor_rank_ordinal, 0)
    order by candidate.rank_ordinal
    limit p_limit + 1
  ), retained_page as materialized (
    select page.*
    from page_plus_one page
    order by page.rank_ordinal
    limit p_limit
  ), page_state as materialized (
    select state.authorized_candidate_count,
           state.query_bound,
           state.source_data_invalid,
           case when state.query_bound or state.source_data_invalid
             then 0 else (select count(*) from page_plus_one) end::integer
             as raw_page_count,
           case when state.query_bound or state.source_data_invalid
             then '[]'::jsonb else coalesce((
               select jsonb_agg(jsonb_build_object(
                 'rank_ordinal', page.rank_ordinal,
                 'source_kind', page.job_kind,
                 'source_id', page.job_id
               ) order by page.rank_ordinal)
               from page_plus_one page
             ), '[]'::jsonb) end as page_rows,
           case when state.query_bound or state.source_data_invalid
             then false else (select count(*) from page_plus_one) > p_limit
             end as has_more
    from candidate_state state
  ), canonical_request as materialized (
    select jsonb_strip_nulls(jsonb_build_object(
      'query', p_query,
      'query_fields', to_jsonb(p_query_fields),
      'job_kinds', to_jsonb(p_job_kinds),
      'lifecycle_states', to_jsonb(p_lifecycle_states),
      'opportunity_stages', to_jsonb(p_opportunity_stages),
      'project_statuses', to_jsonb(p_project_statuses),
      'date_window', case when p_date_field is null then null else
        jsonb_build_object(
          'field', p_date_field,
          'from', private.agent_rfc3339_utc(p_date_from),
          'to_exclusive', private.agent_rfc3339_utc(p_date_to_exclusive)
        ) end,
      'limit', p_limit
    )) as canonical_input
  ), match_projection as materialized (
    select match.*,
           context.source_revision,
           jsonb_build_object(
             'actor_user_id', p_actor_user_id,
             'company_id', p_company_id,
             'capability_id', p_capability_id,
             'capability_revision', p_capability_revision,
             'capability_manifest_revision',
               p_capability_manifest_revision,
             'schema_revision', p_capability_schema_revision,
             'permission_snapshot_revision',
               p_permission_snapshot_revision,
             'canonical_input', request.canonical_input,
             'read_at', private.agent_rfc3339_utc(v_read_as_of),
             'source_revision', context.source_revision,
             'ranking_revision', p_ranking_revision,
             'retained_proof_sources', '[]'::jsonb,
             'rank_ordinal', match.rank_ordinal,
             'selection_witness', match.selection_witness,
             'match', match.raw
           ) as projection
    from retained_page match
    cross join authority_context context
    cross join canonical_request request
  ), match_hashed as materialized (
    select projection.*,
           'sha256:' || encode(extensions.digest(convert_to(
             private.canonical_agent_projection_json(projection.projection),
             'UTF8'
           ), 'sha256'), 'hex') as source_content_hash
    from match_projection projection
  ), match_claim as materialized (
    select match.*,
           jsonb_build_object(
             'source_domain', 'operations',
             'source_type', 'job_discovery_projection',
             'source_id', match.job_kind || ':' || match.job_id::text ||
               ':ordinal:' || match.rank_ordinal::text,
             'version', 'job_discovery_projection:v1:' ||
               match.source_content_hash
           ) as source_version
    from match_hashed match
  ), next_cursor as materialized (
    select case when page.has_more then (
      select jsonb_build_object(
        'source_revision', context.source_revision,
        'read_as_of', private.agent_rfc3339_utc(v_read_as_of),
        'rank_ordinal', last_match.rank_ordinal,
        'source_kind', last_match.job_kind,
        'source_id', last_match.job_id
      )
      from retained_page last_match
      order by last_match.rank_ordinal desc
      limit 1
    ) else null end as claims
    from page_state page
    cross join authority_context context
  ), collection_raw as materialized (
    select jsonb_build_object(
      'authorized_candidate_count', page.authorized_candidate_count,
      'raw_page_count', page.raw_page_count,
      'page_rows', page.page_rows,
      'returned_match_count', case
        when page.query_bound or page.source_data_invalid then 0
        else (select count(*) from match_claim) end,
      'has_more', page.has_more,
      'next_cursor_claims', cursor.claims,
      'cursor_anchor_order_witness', cursor_state.order_witness,
      'gaps', case
        when page.query_bound then jsonb_build_array('SOURCE_QUERY_BOUND')
        when page.source_data_invalid
          then jsonb_build_array('SOURCE_DATA_INVALID')
        else '[]'::jsonb end
    ) as raw
    from page_state page
    cross join next_cursor cursor
    cross join cursor_anchor cursor_state
  ), collection_projection as materialized (
    select collection.raw,
           context.source_revision,
           jsonb_build_object(
             'actor_user_id', p_actor_user_id,
             'company_id', p_company_id,
             'capability_id', p_capability_id,
             'capability_revision', p_capability_revision,
             'capability_manifest_revision',
               p_capability_manifest_revision,
             'schema_revision', p_capability_schema_revision,
             'permission_snapshot_revision',
               p_permission_snapshot_revision,
             'canonical_input', request.canonical_input,
             'read_at', private.agent_rfc3339_utc(v_read_as_of),
             'source_revision', context.source_revision,
             'ranking_revision', p_ranking_revision,
             'retained_proof_sources', coalesce((
               select jsonb_agg(match.source_version
                 order by match.rank_ordinal)
               from match_claim match
             ), '[]'::jsonb),
             'collection', collection.raw
           ) as projection
    from collection_raw collection
    cross join authority_context context
    cross join canonical_request request
    cross join cursor_anchor cursor_state
    where cursor_state.valid
  ), collection_hashed as materialized (
    select collection.*,
           'sha256:' || encode(extensions.digest(convert_to(
             private.canonical_agent_projection_json(collection.projection),
             'UTF8'
           ), 'sha256'), 'hex') as source_content_hash
    from collection_projection collection
  ), final_result as materialized (
    select jsonb_build_object(
      'company_id', p_company_id,
      'permission_snapshot_revision', p_permission_snapshot_revision,
      'read_at', private.agent_rfc3339_utc(v_read_as_of),
      'source_fence', jsonb_build_object(
        'source_domain', 'operations',
        'source_type', 'operational_read_revision',
        'source_id', 'private.agent_operational_read_revisions',
        'version', 'revision:' || collection.source_revision::text
      ),
      'ranking_revision', p_ranking_revision,
      'authorized_candidate_count', collection.raw ->
        'authorized_candidate_count',
      'raw_page_count', collection.raw -> 'raw_page_count',
      'page_rows', collection.raw -> 'page_rows',
      'match_claims', coalesce((
        select jsonb_agg(jsonb_build_object(
          'rank_ordinal', match.rank_ordinal,
          'raw', match.raw,
          'proof', jsonb_build_object(
            'source_version', match.source_version,
            'source_content_hash', match.source_content_hash,
            'evidence_id', match.evidence_id,
            'projection', match.projection
          ),
          'source_version', match.source_version,
          'evidence', jsonb_build_array(jsonb_build_object(
            'evidence_id', match.evidence_id,
            'source_domain', 'operations',
            'source_type', 'job_discovery_projection',
            'source_id', match.job_kind || ':' || match.job_id::text ||
              ':ordinal:' || match.rank_ordinal::text,
            'version', match.source_version ->> 'version',
            'occurred_at', private.agent_rfc3339_utc(v_read_as_of),
            'relationship', 'supports',
            'locator', 'ops://evidence/' || replace(
              match.evidence_id, ':', '%3A'
            ),
            'trust', 'authoritative_ops'
          )),
          'selection_witness', match.selection_witness
        ) order by match.rank_ordinal)
        from match_claim match
      ), '[]'::jsonb),
      'returned_match_count', collection.raw -> 'returned_match_count',
      'has_more', collection.raw -> 'has_more',
      'next_cursor_claims', collection.raw -> 'next_cursor_claims',
      'gaps', collection.raw -> 'gaps',
      'collection_claim', jsonb_build_object(
        'raw', collection.raw,
        'proof', jsonb_build_object(
          'source_version', jsonb_build_object(
            'source_domain', 'operations',
            'source_type', 'job_discovery_collection_projection',
            'source_id', 'company:' || p_company_id::text,
            'version', 'job_discovery_collection_projection:v1:' ||
              collection.source_content_hash
          ),
          'source_content_hash', collection.source_content_hash,
          'evidence_id',
            'evidence:job_discovery_collection_projection:company:' ||
              p_company_id::text,
          'projection', collection.projection
        ),
        'source_version', jsonb_build_object(
          'source_domain', 'operations',
          'source_type', 'job_discovery_collection_projection',
          'source_id', 'company:' || p_company_id::text,
          'version', 'job_discovery_collection_projection:v1:' ||
            collection.source_content_hash
        ),
        'evidence', jsonb_build_array(jsonb_build_object(
          'evidence_id',
            'evidence:job_discovery_collection_projection:company:' ||
              p_company_id::text,
          'source_domain', 'operations',
          'source_type', 'job_discovery_collection_projection',
          'source_id', 'company:' || p_company_id::text,
          'version', 'job_discovery_collection_projection:v1:' ||
            collection.source_content_hash,
          'occurred_at', private.agent_rfc3339_utc(v_read_as_of),
          'relationship', 'supports',
          'locator', 'ops://evidence/' || replace(
            'evidence:job_discovery_collection_projection:company:' ||
              p_company_id::text,
            ':', '%3A'
          ),
          'trust', 'authoritative_ops'
        ))
      )
    ) as result
    from collection_hashed collection
  )
  select final.result
  into v_result
  from final_result final;

  if v_result is null then
    if p_cursor_source_revision is not null then
      raise exception 'agent_job_discovery_cursor_stale'
        using errcode = '40001', detail = coalesce((
          select jsonb_build_object(
            'source_domain', 'operations',
            'source_type', 'operational_read_revision',
            'source_id', 'private.agent_operational_read_revisions',
            'version', 'revision:' || revision.source_revision::text
          )::text
          from private.agent_operational_read_revisions revision
          where revision.company_id = p_company_id
            and revision.source_revision between 0 and 9007199254740991
        ), '{}');
    end if;
    raise exception 'agent_job_discovery_not_found_or_not_visible'
      using errcode = 'P0002';
  end if;
  if octet_length(v_result::text) > 1048576 then
    raise exception 'agent_job_discovery_source_query_bound'
      using errcode = '54000';
  end if;
  return v_result;
end;
$function$;

revoke all on function public.read_agent_job_discovery_as_system(
  text, uuid, uuid, text, text[], text, text, text, text, text, text[], text,
  text, text, text[], text[], text[], text[], text[], text, timestamptz, timestamptz,
  timestamptz, bigint, integer, text, uuid, integer
) from public, anon, authenticated, service_role;
grant execute on function public.read_agent_job_discovery_as_system(
  text, uuid, uuid, text, text[], text, text, text, text, text, text[], text,
  text, text, text[], text[], text[], text[], text[], text, timestamptz, timestamptz,
  timestamptz, bigint, integer, text, uuid, integer
) to service_role;

commit;
