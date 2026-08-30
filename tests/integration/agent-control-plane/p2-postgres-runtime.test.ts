import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

const RUNNER_FILE = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(RUNNER_FILE), "../../..");
const PSQL_TIMEOUT_MS = 120_000;
const LIFECYCLE_TIMEOUT_MS = 30_000;
const MIGRATIONS = [
  [
    "20260823072825_agent_manifest_v8_compatibility.sql",
    "c9fddfa48cf77b85693dbcc1082c7493401427fda4e5c2e3d0ea98b8d0673ba5",
  ],
  [
    "20260823072831_agent_read_domain_revisions.sql",
    "977e61251919856075cb0393c3a452b78247cd0833e7a0dbb18b0ba3c86e0057",
  ],
  [
    "20260823072837_mcp_oauth_consent_catalog_versioning.sql",
    "8982be2396494d8256b88aba99a31977028d5c5eac2876f11b716732be2fa86a",
  ],
  [
    "20260823072843_agent_mcp_durable_rate_limit.sql",
    "18b8ac95361da13dda69b018e043e2c2ef3c9fb809dabb1f912dba6b3e987ad5",
  ],
  [
    "20260823072849_agent_mcp_evidence_nonce_ledger.sql",
    "eb6b2a84c08ed4447163a1c60a14c67df47652dbc3f39383304abba0a7e147b0",
  ],
  [
    "20260823080451_agent_p2_legacy_attention_projections.sql",
    "2647dff9c4ee46d6b2aa776aa51f1b32c6a66d010bad75faadf0f4dc241bcb97",
  ],
  [
    "20260823100016_agent_customer_context_sources.sql",
    "824fe77f29908954e6951bc74896825bedbfc81f6c758dc56cc82c4e9d627550",
  ],
  [
    "20260823100019_agent_customer_context_read.sql",
    "8d16397e350e6f3149bc5c2c7e424b16ec1b38a3c50fd5811efb060a8e6135ed",
  ],
  [
    "20260827233026_agent_task_sources.sql",
    "8403e385c25e21e8a7246d8b829698bc8c4ac991ec6cdbbb26fbf5fd14b6b2ef",
  ],
  [
    "20260827233034_agent_task_reads.sql",
    "68f9b54d90c056052ab37cece857ca868e7d676b310a7e3ebe7ec5a915e67ae5",
  ],
  [
    "20260827233630_agent_artifact_sources.sql",
    "b587a36f3999e6af42c93ec21aa04906dadf8c5b1aecc54f5734db5ffd794049",
  ],
  [
    "20260827233640_agent_artifact_reads.sql",
    "20b916059f35d0c3580edc37151ac2ae5e8a9d3bd39e47417fcd8cedda721b8c",
  ],
  [
    "20260828211556_agent_site_visit_sources.sql",
    "031c222afc64fc0278782fa6432bc82b2dc8ab481725f50444ff8329a15afa32",
  ],
  [
    "20260828211605_agent_site_visit_reads.sql",
    "5c8d9284e8573501ab34a8c9d35b5ebf7c7e63e1d69d1610637b4d16b6d172d9",
  ],
  [
    "20260829011311_agent_deck_design_sources.sql",
    "23f0127151dffdf6545434adae18c98793361ef3c53f89e516008cb51691f517",
  ],
  [
    "20260829011319_agent_deck_design_geometry_read.sql",
    "8e3b2dff5b3f33203be3fc14fb25625e0bbfba4915b60ea1c785cc955dad6d97",
  ],
  [
    "20260829013804_agent_mcp_evidence_redemption_rpc.sql",
    "441a6ce8d26bc7814a9cce622c0eae0eab423f134ca07e9a3011ec4b41465be6",
  ],
  [
    "20260829024746_agent_sales_document_sources.sql",
    "93c0f605dab1d1441a21585b414a5e4d506cbf7e40f658e8b4cecd7f0c7fd8cc",
  ],
  [
    "20260829024749_agent_sales_document_reads.sql",
    "96b68ed8123bd9863f4cfbd94d79a7bebbb563441ea3fd48da42ff1e67be6409",
  ],
  [
    "20260829040045_agent_expense_reimbursement_sources.sql",
    "6b0f02888b66bb1e0ce4ae4ac009621cdbbf49769de28d896a19ab1ce8cfcaf3",
  ],
  [
    "20260829040046_agent_expense_reads.sql",
    "e6e765e3c677fae19b0f65bbf878e59a0a0e90b55c4f837e7c642fd1b7587ec8",
  ],
  [
    "20260829040356_agent_company_sources.sql",
    "7364fb8746b5c461e3a83bb28037f6a11f0388c83a8fa301107884093d4cc6fd",
  ],
  [
    "20260829040402_agent_company_context_read.sql",
    "081ce68053a1c7c3e94f9b4f314780871934e8ac05d9a999c9878428d8ef761d",
  ],
  [
    "20260829061203_agent_catalog_sources.sql",
    "c9b0ae07aedde2610880ca249686d46e74a24eb10fc1c62f11359228e4cc37a9",
  ],
  [
    "20260829061214_agent_catalog_reads.sql",
    "5863ce2d76da78fa3d7d7faa7036e426c9a2a66ddd584a6bcfccb4b3df73fe66",
  ],
  [
    "20260829063450_agent_team_sources.sql",
    "38f87419d7b22eb5f788277bd77502f38f94b6e8bf6c8b93defb7cbb170dbb93",
  ],
  [
    "20260829063451_agent_team_members_read.sql",
    "d13dfc1db41d600b061970f8e4871d386680fa5e94da766d1e38acdbea251b57",
  ],
  [
    "20260829074110_agent_availability_sources.sql",
    "f99f1659e0615c7c7b1a7b33f71d99e4b4c68378f649d411687ba988cc1367de",
  ],
  [
    "20260829074111_agent_team_availability_read.sql",
    "b7277c75f684868dab212bce2e3eb401093a4c3c0eda0792b193a0cf589ad8b6",
  ],
  [
    "20260829081500_agent_payment_sources.sql",
    "cbf4da71b7ee9768ddb569fed89bfccd3871a8d1ff5c93d79f901f5189c2a6c4",
  ],
  [
    "20260829081501_agent_payment_read.sql",
    "f3b6da180a0f56263ad51f72882e0f8b63667896a42efdd0cbe543c936483f8d",
  ],
  [
    "20260829091311_agent_purchasing_sources.sql",
    "7b6cf1df590902b381262be93156fd8b116a77f9e4a1b66aa2d60607ac1877e8",
  ],
  [
    "20260829091329_agent_purchase_order_reads.sql",
    "6668c537b5bfb600616865c71ad72c6ac4143d469673cfb048d6b600b63a51cf",
  ],
  [
    "20260829102510_agent_integration_health_sources.sql",
    "96539e1f461547d61f44231416c8a25dd51d646255d2ff827b5637feed2e16f1",
  ],
  [
    "20260829102520_agent_integration_health_read.sql",
    "ba5ba06b232a1a67bcb189a5a6dc5a69e76d3dcedb5bf9496a02d40fef31aa97",
  ],
  [
    "20260829110000_agent_work_queue_sources.sql",
    "59f2aab22c36e141db0e871fd51167472c2276b4ee8203d6ae91436a2991e1b5",
  ],
  [
    "20260829110001_agent_work_queue_read.sql",
    "f4820a04058b3d3794615ff3efae3a96c036f76da0d90e2d293cc2df7e5179c6",
  ],
  [
    "20260829110002_agent_operational_overview_read.sql",
    "16dcf0e3cb55e29dd250bf50871ec0db76a46929123d969d8ef8eca588527815",
  ],
  [
    "20260829192448_mcp_oauth_codex_dcr_callbacks.sql",
    "5a26ff566858e06994f50652c94d7afc3c4a0d1b6bc3891897bcf2e9868831a9",
  ],
  [
    "20260830113800_mcp_oauth_chatgpt_rfc9207_callback.sql",
    "2e0893b8312fb0cbb264228a4ac97155c2649aefd6e42040cc5b1369a09f7e59",
  ],
  [
    "20260830120000_agent_mcp_scope_set_binding.sql",
    "2b547aa95aeb8b7b665707f12119432d0d106958192277a8ec64204bdd51c25b",
  ],
  [
    "20260830140000_agent_mcp_scope_canonical_order.sql",
    "62f72279370c1cd17068e0b88f0f3cb3194a415fc0a7acc3cb4138d043d13463",
  ],
  [
    "20260830150000_agent_mcp_financial_tombstones.sql",
    "5295e822b9f2549014423b8b64230bfb292dfead6014e04646dd19414499d077",
  ],
  [
    "20260830160000_agent_mcp_postgres_uuid_compatibility.sql",
    "636a8e9d7f178d8339a3458658130463fe5cedf47716a0ed447bc20c98e1dc06",
  ],
  [
    "20260830170000_agent_site_visit_nullable_client_visibility.sql",
    "b2b8fb251cee5eba4d4cf780b157fc3288e5e3a0daab947ce22865e59bf5d6f9",
  ],
] as const;

const FIXTURE_GROUPS = [
  [
    "agent-manifest-v8-compatibility-runtime.sql",
    "agent-manifest-v8-compatibility-replay-runtime.sql",
  ],
  ["agent-read-domain-revisions-runtime.sql"],
  ["agent-mcp-oauth-consent-catalog-runtime.sql"],
  ["agent-mcp-rate-limiter-runtime.sql"],
  ["agent-p2-legacy-attention-projections-runtime.sql"],
  [
    "agent-customer-context-runtime.sql",
    "agent-customer-context-replay-runtime.sql",
  ],
  ["agent-task-reads-runtime.sql"],
  [
    "agent-artifact-reads-runtime.sql",
    "agent-artifact-reads-replay-runtime.sql",
  ],
  ["agent-site-visit-reads-runtime.sql"],
  [
    "agent-deck-design-geometry-runtime.sql",
    "agent-deck-design-geometry-replay-runtime.sql",
  ],
  ["agent-mcp-evidence-runtime.sql", "agent-mcp-evidence-replay-runtime.sql"],
  [
    "agent-sales-document-sources-runtime.sql",
    "agent-sales-document-reads-runtime.sql",
    "agent-sales-document-reads-replay-runtime.sql",
  ],
  ["agent-expense-reads-runtime.sql", "agent-expense-reads-replay-runtime.sql"],
  [
    "agent-company-context-runtime.sql",
    "agent-company-context-replay-runtime.sql",
  ],
  [
    "agent-catalog-sources-runtime.sql",
    "agent-catalog-reads-runtime.sql",
    "agent-catalog-reads-replay-runtime.sql",
  ],
  ["agent-team-members-runtime.sql", "agent-team-members-replay-runtime.sql"],
  [
    "agent-team-availability-runtime.sql",
    "agent-team-availability-replay-runtime.sql",
  ],
  ["agent-payment-reads-runtime.sql", "agent-payment-reads-replay-runtime.sql"],
  [
    "agent-purchase-order-reads-runtime.sql",
    "agent-purchase-order-reads-replay-runtime.sql",
  ],
  [
    "agent-integration-health-runtime.sql",
    "agent-integration-health-replay-runtime.sql",
  ],
  [
    "agent-work-queue-reads-runtime.sql",
    "agent-work-queue-reads-replay-runtime.sql",
  ],
  [
    "agent-operational-overview-runtime.sql",
    "agent-operational-overview-replay-runtime.sql",
  ],
  ["agent-mcp-oauth-codex-dcr-runtime.sql"],
  ["agent-mcp-oauth-chatgpt-rfc9207-runtime.sql"],
  [
    "agent-mcp-scope-set-binding-runtime.sql",
    "agent-mcp-scope-set-binding-replay-runtime.sql",
    "agent-mcp-scope-set-binding-boundaries-runtime.sql",
  ],
  [
    "agent-mcp-scope-canonical-order-runtime.sql",
    "agent-mcp-scope-canonical-order-replay-runtime.sql",
  ],
  [
    "agent-mcp-financial-tombstone-runtime.sql",
    "agent-mcp-financial-tombstone-replay-runtime.sql",
  ],
  [
    "agent-mcp-postgres-uuid-runtime.sql",
    "agent-mcp-postgres-uuid-replay-runtime.sql",
  ],
  [
    "agent-site-visit-nullable-client-runtime.sql",
    "agent-site-visit-nullable-client-replay-runtime.sql",
  ],
] as const;

const FIXTURES = [
  [
    "agent-manifest-v8-compatibility-runtime.sql",
    "8437d418028558b3102a60bc65b29859e5a76c937eb3eb80c9c47c1304473c49",
  ],
  [
    "agent-manifest-v8-compatibility-replay-runtime.sql",
    "32a482695d37290e4bcb96f71be0e12844f373e16435b6f64e93b8cddc837c60",
  ],
  [
    "agent-read-domain-revisions-runtime.sql",
    "edd21da1cdedd8a53f3da0274d61aa4c2c427c019d0eb66b847653a8580b5949",
  ],
  [
    "agent-mcp-oauth-consent-catalog-runtime.sql",
    "521c3fb7818100fca0b3f0b73cd548519554268a11c0895a22dc4e80e438f2de",
  ],
  [
    "agent-mcp-rate-limiter-runtime.sql",
    "8370e4bf14bad400bd758ef1ff68214b13028ef12bbd9fcdb9645d7f0142d4b5",
  ],
  [
    "agent-p2-legacy-attention-projections-runtime.sql",
    "37d13356b2f3b80f608e8c5bb9326eb3d934f71ba7e6b89cd60464d13e8c01f0",
  ],
  [
    "agent-customer-context-runtime.sql",
    "eb8cbd6fe9f999ae4c951a7d806937e26c38216f8a6b94a9be25f3ddd2afc80f",
  ],
  [
    "agent-customer-context-replay-runtime.sql",
    "64f594ddda91b9422f866d602ba914bb4adefbc9a7a977403adecd2f538b490e",
  ],
  [
    "agent-task-reads-runtime.sql",
    "7dec7dac2085c85c130374e13cb4df4827fb33618df43cd684861049229fe3fb",
  ],
  [
    "agent-artifact-reads-runtime.sql",
    "5be7ed6a294933b1dfa906bf063ec9bf05cc45a6ee588e1b5a91a1dfb852ff64",
  ],
  [
    "agent-artifact-reads-replay-runtime.sql",
    "be8d75fc884ef8be9c870e8b5047635d19b1df89a63a360b545ec054399e558b",
  ],
  [
    "agent-site-visit-reads-runtime.sql",
    "792fca871ccbafeadf8901d61a223d777d4afb2c39247258d6a0687117a5e383",
  ],
  [
    "agent-deck-design-geometry-runtime.sql",
    "49965299f575e3256e6e9ec0e03ad824d43580e19e9dad848c725c035917625c",
  ],
  [
    "agent-deck-design-geometry-replay-runtime.sql",
    "f4195fbb1a6825281f46dd849e4e462e1427c1fc3ba7341e01ad765e8070beca",
  ],
  [
    "agent-mcp-evidence-runtime.sql",
    "7aa92f0625224eec3032440904620b3d3459c42e40d0911759cf1f2da0eb6cd6",
  ],
  [
    "agent-mcp-evidence-replay-runtime.sql",
    "4dcd39c5d3ab23c3bbba84a7d3473bd97262cf4aa2dd45c2a18a4b9a57f8b5a4",
  ],
  [
    "agent-sales-document-sources-runtime.sql",
    "c8aa802712e54413a708296fd86fb0ab4b326f5de1192036cd36911448492db3",
  ],
  [
    "agent-sales-document-reads-runtime.sql",
    "2fd9bc3a0546adc61540f770c856a0744dc25dc0ca0cdcd34af53956a9b04df7",
  ],
  [
    "agent-sales-document-reads-replay-runtime.sql",
    "f8852d551161fe2fcf853fa7fc8a484ab84674ced74241907921ef9fd54b20d0",
  ],
  [
    "agent-expense-reads-runtime.sql",
    "8793c715ac9ecba67881e6a57f2900d2fad85979757b974685b85dec50aaa791",
  ],
  [
    "agent-expense-reads-replay-runtime.sql",
    "aab6a67bf504efb8eaaef187e04430bff048b749a9e29d85283fa0806081140b",
  ],
  [
    "agent-company-context-runtime.sql",
    "8c12d2cbe3baca1726a07646d435765c9981b40b7074952700104a7f4aa75c74",
  ],
  [
    "agent-company-context-replay-runtime.sql",
    "84c42dd198655aa15df72b4e682f0ade88464333be5b6efa3857c1e1f711f90e",
  ],
  [
    "agent-catalog-sources-runtime.sql",
    "32dbb006aace054b160c99489b8f1b9975370c8474c63e077bc94a0e65447666",
  ],
  [
    "agent-catalog-reads-runtime.sql",
    "f457c321c5e82213ee427cf6733e41d7af132586d34bf3a2cfc34a7574bc2afb",
  ],
  [
    "agent-catalog-reads-replay-runtime.sql",
    "9d99accb8a13e43af7e772f9a8ea88c95234023578beb6a23e6183812a8eef7b",
  ],
  [
    "agent-team-members-runtime.sql",
    "1f08eadcfb21bb59896fe08cbbd50deacff7b7c5afa1199e4481468447fb945d",
  ],
  [
    "agent-team-members-replay-runtime.sql",
    "88cef1f01e78427eea9791504eb813ac3150e910835051b6755192431d77c0cd",
  ],
  [
    "agent-team-availability-runtime.sql",
    "159cb3fceecd4dcfb37a4785e215d7937fca394216159a085134243b21dbec1c",
  ],
  [
    "agent-team-availability-replay-runtime.sql",
    "9d2ac6f0f929c070017f7665b7ccacd1be0cad82beb3557a21e2d03200dbcdaf",
  ],
  [
    "agent-payment-reads-runtime.sql",
    "4efe3fea8c14c22b3b07ae477f29aa6a48d8f92dd4b189943741420019b2facf",
  ],
  [
    "agent-payment-reads-replay-runtime.sql",
    "5df3594b15f488139f606769a382b4ca85ef55c33f8b2a4de8ee35943631aba0",
  ],
  [
    "agent-purchase-order-reads-runtime.sql",
    "c110836967c5b21fc3c9648f1e05eec54c1da03524f8d0088467d630ce2717ff",
  ],
  [
    "agent-purchase-order-reads-replay-runtime.sql",
    "cf5fa5f5cdfe88b563a93b7949464d6cba0d99fa301f4a6de15cbeebb238dd97",
  ],
  [
    "agent-integration-health-runtime.sql",
    "f20cf53966018be9299c6315b67448aa2c87fe5988c19350e57a7932d89cdade",
  ],
  [
    "agent-integration-health-replay-runtime.sql",
    "9ea572c8b2dde20dfb85525af86b15db521723b19b3d002c43e5dca9d183204d",
  ],
  [
    "agent-work-queue-reads-runtime.sql",
    "23b45bbd8591fef70178fa4386941e0deadb9240e4e8c487ead63609f0e973f9",
  ],
  [
    "agent-work-queue-reads-replay-runtime.sql",
    "9c546ae93fe3665597850962946ceb26980af467ecf8dcf5bda166e267a12e1c",
  ],
  [
    "agent-operational-overview-runtime.sql",
    "0fffabbc24c373cb2551c1c8264480fa23afaaced8d1f03b1872e1f4cb5f5f4f",
  ],
  [
    "agent-operational-overview-replay-runtime.sql",
    "9d059d0576a4e175f639a52f7986b20744235869202159aade5ba01150b5336c",
  ],
  [
    "agent-mcp-oauth-codex-dcr-runtime.sql",
    "0040c68912e0d470d813ab7cfdfafbecf999111779077a6e8fb6b06dd9b186c0",
  ],
  [
    "agent-mcp-oauth-chatgpt-rfc9207-runtime.sql",
    "354e0915a8d365da9c8445ec29ffb487291de84d9644443487883ffd1e587c18",
  ],
  [
    "agent-mcp-scope-set-binding-runtime.sql",
    "8f006536e42ba6eaaffcba33c2fd07cee8c4cbcd59f085e0b8f443f3d2cad4af",
  ],
  [
    "agent-mcp-scope-set-binding-replay-runtime.sql",
    "53688e6da2a88781b1b41bc2df27d28131b495c693cb1d9b45539c2f8adae9c5",
  ],
  [
    "agent-mcp-scope-set-binding-boundaries-runtime.sql",
    "2bcc16fed29cfdfcdb5f04c678919d5685845f7842ce14fbf2d85cf82997e13c",
  ],
  [
    "agent-mcp-scope-canonical-order-runtime.sql",
    "ac7009b32d4cff23291a09d51c595d7cbdd10f89153275038c300fb50057e7bd",
  ],
  [
    "agent-mcp-scope-canonical-order-replay-runtime.sql",
    "306073dbd5dc435578394ca117b5c053303c1583e5c0652e30c1ca77c1a64009",
  ],
  [
    "agent-mcp-financial-tombstone-runtime.sql",
    "41a57c2f2a1ed2051944ed18736538e08a1723a49ee6b2eec03f8c4160b0e1e5",
  ],
  [
    "agent-mcp-financial-tombstone-replay-runtime.sql",
    "471b4185649177907baae770fa1efc9554d8240904d39c913c1391f2e79e0f9f",
  ],
  [
    "agent-mcp-postgres-uuid-runtime.sql",
    "59fcf872ea583e2f2df889fb1c70865ef5c74f670942dc15196047e9cd5ce55b",
  ],
  [
    "agent-mcp-postgres-uuid-replay-runtime.sql",
    "76d34ce0e1294fc3c80def189b4994ae8be78ae9daaf6af288addc485c98a440",
  ],
  [
    "agent-site-visit-nullable-client-runtime.sql",
    "83a85b73b0ea04b80b344edae827c096f9c9dc9a2ad0cbadd0a01f69801b2b6e",
  ],
  [
    "agent-site-visit-nullable-client-replay-runtime.sql",
    "ced8ddebc81d877cd872c46543cc3d70e8dd7a29f346bd7aff57754daff93565",
  ],
] as const;

const BASELINE_SHA256 =
  "2d3880dc56ba664b844f24fb0af68337011c3264a17d49a9a0d471bacbe73ec6";
const BASELINE_PREREQUISITES = [
  [
    "20260818155813_mcp_oauth_authorization_server.sql",
    "c4fbd3a4a624a25b88d81d4c1feaf46b668ba1e5978ee60677e9f7445c1c9b0a",
  ],
] as const;

const FIXTURE_CHECKPOINT_MIGRATIONS = [
  "20260823072825_agent_manifest_v8_compatibility.sql",
  "20260823072831_agent_read_domain_revisions.sql",
  "20260823072837_mcp_oauth_consent_catalog_versioning.sql",
  "20260823072843_agent_mcp_durable_rate_limit.sql",
  "20260823080451_agent_p2_legacy_attention_projections.sql",
  "20260823100019_agent_customer_context_read.sql",
  "20260827233034_agent_task_reads.sql",
  "20260827233640_agent_artifact_reads.sql",
  "20260828211605_agent_site_visit_reads.sql",
  "20260829011319_agent_deck_design_geometry_read.sql",
  "20260829013804_agent_mcp_evidence_redemption_rpc.sql",
  "20260829024749_agent_sales_document_reads.sql",
  "20260829040046_agent_expense_reads.sql",
  "20260829040402_agent_company_context_read.sql",
  "20260829061214_agent_catalog_reads.sql",
  "20260829063451_agent_team_members_read.sql",
  "20260829074111_agent_team_availability_read.sql",
  "20260829081501_agent_payment_read.sql",
  "20260829091329_agent_purchase_order_reads.sql",
  "20260829102520_agent_integration_health_read.sql",
  "20260829110001_agent_work_queue_read.sql",
  "20260829110002_agent_operational_overview_read.sql",
  "20260829192448_mcp_oauth_codex_dcr_callbacks.sql",
  "20260830113800_mcp_oauth_chatgpt_rfc9207_callback.sql",
  "20260830120000_agent_mcp_scope_set_binding.sql",
  "20260830140000_agent_mcp_scope_canonical_order.sql",
  "20260830150000_agent_mcp_financial_tombstones.sql",
  "20260830160000_agent_mcp_postgres_uuid_compatibility.sql",
  "20260830170000_agent_site_visit_nullable_client_visibility.sql",
] as const;

const BASELINE = join(
  ROOT,
  "tests/sql/agent-p2-full-wave-postgres17-baseline.sql"
);
const RUN_POSTGRES = process.env.OPS_RUN_P2_POSTGRES_RUNTIME === "1";
const PSQL =
  process.env.OPS_PSQL_BIN ?? "/opt/homebrew/opt/postgresql@17/bin/psql";
const CREATEDB =
  process.env.OPS_CREATEDB_BIN ??
  join(
    dirname(PSQL),
    process.platform === "win32" ? "createdb.exe" : "createdb"
  );
const DROPDB =
  process.env.OPS_DROPDB_BIN ??
  join(dirname(PSQL), process.platform === "win32" ? "dropdb.exe" : "dropdb");
const PG_HOST = process.env.OPS_PGHOST ?? "/tmp";
const PG_PORT = process.env.OPS_PGPORT ?? "55414";
const PG_USER = process.env.OPS_PGUSER ?? process.env.USER ?? "postgres";
const PRODUCTION_DATABASE_LOCALE_PROVIDER = "i";
const PRODUCTION_DATABASE_LOCALE = "en-US";
const RELEASE_BOOTSTRAP_OAUTH_SENTINELS_SQL = `
begin;
delete from private.mcp_oauth_tokens
where grant_id = '44444444-4444-4444-8444-444444444444'::uuid;
delete from private.mcp_oauth_authorization_codes
where code_hash = repeat('a', 64);
delete from private.mcp_oauth_grants
where id = '44444444-4444-4444-8444-444444444444'::uuid;
delete from private.mcp_oauth_clients
where client_id = '11111111-1111-4111-8111-111111111111'::uuid;
delete from private.agent_read_domain_revisions
where company_id = '33333333-3333-4333-8333-333333333333'::uuid;
delete from public.users
where id = '22222222-2222-4222-8222-222222222222'::uuid
  and company_id = '33333333-3333-4333-8333-333333333333'::uuid;
delete from public.companies
where id = '33333333-3333-4333-8333-333333333333'::uuid;
commit;
`;

const SCOPE_SET_BINDING_ADVERSARIAL_DRIFT_SQL = `
do $scope_set_binding_drift$
declare
  v_signature constant text :=
    'private.agent_p2_company_summary_v1(uuid,uuid,uuid,uuid,text,text[],text[],text,text[],text,timestamp with time zone)';
  v_definition text;
  v_drifted_definition text;
begin
  select pg_catalog.pg_get_functiondef(
           pg_catalog.to_regprocedure(v_signature)::oid
         )
    into strict v_definition;

  v_drifted_definition := pg_catalog.replace(
    v_definition,
    'private.agent_mcp_oauth_scope_sets_equal(oauth_grant.scopes, p_granted_scope_ceiling)',
    'private.agent_mcp_oauth_scope_sets_equal(oauth_grant.scopes, oauth_grant.scopes)'
  );
  if v_drifted_definition is not distinct from v_definition then
    raise exception 'agent_mcp_scope_set_binding_adversarial_setup_failed';
  end if;
  execute v_drifted_definition;
end;
$scope_set_binding_drift$;
`;

const SCOPE_CANONICAL_ORDER_ADVERSARIAL_DRIFT_SQL = `
do $scope_canonical_order_drift$
declare
  v_signature constant text :=
    'private.agent_p2_catalog_read_context_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],jsonb,boolean)';
  v_expected_fragment constant text :=
    'scope.value order by scope.value collate "C"';
  v_drifted_fragment constant text :=
    'scope.value order by scope.value collate "C" nulls first';
  v_definition text;
  v_drifted_definition text;
  v_expected_count integer;
  v_drifted_count integer;
begin
  select pg_catalog.pg_get_functiondef(
           pg_catalog.to_regprocedure(v_signature)::oid
         )
    into strict v_definition;

  v_expected_count := (
    pg_catalog.length(v_definition) - pg_catalog.length(
      pg_catalog.replace(v_definition, v_expected_fragment, '')
    )
  ) / pg_catalog.length(v_expected_fragment);
  v_drifted_count := (
    pg_catalog.length(v_definition) - pg_catalog.length(
      pg_catalog.replace(v_definition, v_drifted_fragment, '')
    )
  ) / pg_catalog.length(v_drifted_fragment);
  if v_expected_count is distinct from 1
     or v_drifted_count is distinct from 0 then
    raise exception
      'agent_mcp_scope_canonical_order_adversarial_setup_failed: % %',
      v_expected_count, v_drifted_count;
  end if;

  v_drifted_definition := pg_catalog.replace(
    v_definition,
    v_expected_fragment,
    v_drifted_fragment
  );
  if v_drifted_definition is not distinct from v_definition then
    raise exception 'agent_mcp_scope_canonical_order_adversarial_setup_failed';
  end if;
  execute v_drifted_definition;
end;
$scope_canonical_order_drift$;
`;

const SCOPE_CANONICAL_ORDER_ADVERSARIAL_RESTORE_SQL = `
do $scope_canonical_order_restore$
declare
  v_signature constant text :=
    'private.agent_p2_catalog_read_context_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],jsonb,boolean)';
  v_expected_fragment constant text :=
    'scope.value order by scope.value collate "C" nulls first';
  v_restored_fragment constant text :=
    'scope.value order by scope.value collate "C"';
  v_definition text;
  v_restored_definition text;
  v_expected_count integer;
begin
  select pg_catalog.pg_get_functiondef(
           pg_catalog.to_regprocedure(v_signature)::oid
         )
    into strict v_definition;

  v_expected_count := (
    pg_catalog.length(v_definition) - pg_catalog.length(
      pg_catalog.replace(v_definition, v_expected_fragment, '')
    )
  ) / pg_catalog.length(v_expected_fragment);
  if v_expected_count is distinct from 1 then
    raise exception
      'agent_mcp_scope_canonical_order_adversarial_restore_failed: %',
      v_expected_count;
  end if;

  v_restored_definition := pg_catalog.replace(
    v_definition,
    v_expected_fragment,
    v_restored_fragment
  );
  if v_restored_definition is not distinct from v_definition then
    raise exception 'agent_mcp_scope_canonical_order_adversarial_restore_failed';
  end if;
  execute v_restored_definition;
end;
$scope_canonical_order_restore$;
`;

const FINANCIAL_TOMBSTONE_ADVERSARIAL_DRIFT_SQL = `
do $financial_tombstone_drift$
declare
  v_signature constant text :=
    'private.agent_p2_payment_source_v1(uuid,uuid,uuid,text,uuid,date,date,text[],text[],text,timestamp with time zone,integer)';
  v_expected_fragment constant text :=
    'parent_invoice.deleted_at is not null';
  v_drifted_fragment constant text :=
    'parent_invoice.deleted_at is not null\n          and true';
  v_definition text;
  v_drifted_definition text;
  v_expected_count integer;
  v_drifted_count integer;
begin
  select pg_catalog.pg_get_functiondef(
           pg_catalog.to_regprocedure(v_signature)::oid
         )
    into strict v_definition;

  v_expected_count := (
    pg_catalog.length(v_definition) - pg_catalog.length(
      pg_catalog.replace(v_definition, v_expected_fragment, '')
    )
  ) / pg_catalog.length(v_expected_fragment);
  v_drifted_count := (
    pg_catalog.length(v_definition) - pg_catalog.length(
      pg_catalog.replace(v_definition, v_drifted_fragment, '')
    )
  ) / pg_catalog.length(v_drifted_fragment);
  if v_expected_count is distinct from 1
     or v_drifted_count is distinct from 0 then
    raise exception
      'agent_mcp_financial_tombstone_adversarial_setup_failed: % %',
      v_expected_count, v_drifted_count;
  end if;

  v_drifted_definition := pg_catalog.replace(
    v_definition,
    v_expected_fragment,
    v_drifted_fragment
  );
  if v_drifted_definition is not distinct from v_definition then
    raise exception 'agent_mcp_financial_tombstone_adversarial_setup_failed';
  end if;
  execute v_drifted_definition;
end;
$financial_tombstone_drift$;
`;

const FINANCIAL_TOMBSTONE_ADVERSARIAL_RESTORE_SQL = `
do $financial_tombstone_restore$
declare
  v_signature constant text :=
    'private.agent_p2_payment_source_v1(uuid,uuid,uuid,text,uuid,date,date,text[],text[],text,timestamp with time zone,integer)';
  v_expected_fragment constant text :=
    'parent_invoice.deleted_at is not null\n          and true';
  v_restored_fragment constant text :=
    'parent_invoice.deleted_at is not null';
  v_definition text;
  v_restored_definition text;
  v_expected_count integer;
begin
  select pg_catalog.pg_get_functiondef(
           pg_catalog.to_regprocedure(v_signature)::oid
         )
    into strict v_definition;

  v_expected_count := (
    pg_catalog.length(v_definition) - pg_catalog.length(
      pg_catalog.replace(v_definition, v_expected_fragment, '')
    )
  ) / pg_catalog.length(v_expected_fragment);
  if v_expected_count is distinct from 1 then
    raise exception
      'agent_mcp_financial_tombstone_adversarial_restore_failed: %',
      v_expected_count;
  end if;

  v_restored_definition := pg_catalog.replace(
    v_definition,
    v_expected_fragment,
    v_restored_fragment
  );
  if v_restored_definition is not distinct from v_definition then
    raise exception 'agent_mcp_financial_tombstone_adversarial_restore_failed';
  end if;
  execute v_restored_definition;
end;
$financial_tombstone_restore$;
`;

const POSTGRES_UUID_ADVERSARIAL_DRIFT_SQL = `
do $postgres_uuid_drift$
declare
  v_signature constant text :=
    'private.agent_p2_artifact_uuid_from_text(text)';
  v_expected_fragment constant text :=
    'if p_value !~\n    ''^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$''';
  v_drifted_fragment constant text :=
    'if p_value !~\n    /* adversarial drift */\n    ''^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$''';
  v_definition text;
  v_drifted_definition text;
  v_expected_count integer;
  v_drifted_count integer;
begin
  select pg_catalog.pg_get_functiondef(
           pg_catalog.to_regprocedure(v_signature)::oid
         )
    into strict v_definition;

  v_expected_count := (
    pg_catalog.length(v_definition) - pg_catalog.length(
      pg_catalog.replace(v_definition, v_expected_fragment, '')
    )
  ) / pg_catalog.length(v_expected_fragment);
  v_drifted_count := (
    pg_catalog.length(v_definition) - pg_catalog.length(
      pg_catalog.replace(v_definition, v_drifted_fragment, '')
    )
  ) / pg_catalog.length(v_drifted_fragment);
  if v_expected_count is distinct from 1
     or v_drifted_count is distinct from 0 then
    raise exception
      'agent_mcp_postgres_uuid_adversarial_setup_failed: % %',
      v_expected_count, v_drifted_count;
  end if;

  v_drifted_definition := pg_catalog.replace(
    v_definition,
    v_expected_fragment,
    v_drifted_fragment
  );
  if v_drifted_definition is not distinct from v_definition then
    raise exception 'agent_mcp_postgres_uuid_adversarial_setup_failed';
  end if;
  execute v_drifted_definition;
end;
$postgres_uuid_drift$;
`;

const POSTGRES_UUID_ADVERSARIAL_RESTORE_SQL = `
do $postgres_uuid_restore$
declare
  v_signature constant text :=
    'private.agent_p2_artifact_uuid_from_text(text)';
  v_expected_fragment constant text :=
    'if p_value !~\n    /* adversarial drift */\n    ''^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$''';
  v_restored_fragment constant text :=
    'if p_value !~\n    ''^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$''';
  v_definition text;
  v_restored_definition text;
  v_expected_count integer;
begin
  select pg_catalog.pg_get_functiondef(
           pg_catalog.to_regprocedure(v_signature)::oid
         )
    into strict v_definition;

  v_expected_count := (
    pg_catalog.length(v_definition) - pg_catalog.length(
      pg_catalog.replace(v_definition, v_expected_fragment, '')
    )
  ) / pg_catalog.length(v_expected_fragment);
  if v_expected_count is distinct from 1 then
    raise exception
      'agent_mcp_postgres_uuid_adversarial_restore_failed: %',
      v_expected_count;
  end if;

  v_restored_definition := pg_catalog.replace(
    v_definition,
    v_expected_fragment,
    v_restored_fragment
  );
  if v_restored_definition is not distinct from v_definition then
    raise exception 'agent_mcp_postgres_uuid_adversarial_restore_failed';
  end if;
  execute v_restored_definition;
end;
$postgres_uuid_restore$;
`;

const SITE_VISIT_ADVERSARIAL_DRIFT_SQL = `
create table private.agent_site_visit_adversarial_guard as
with protected(function_signature) as (values
  ('private.agent_p2_site_visit_list_v1(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],jsonb,text,timestamp with time zone,timestamp with time zone,text[],boolean,uuid,uuid,integer,integer,integer,timestamp with time zone,jsonb,timestamp with time zone,uuid,timestamp with time zone)'),
  ('private.agent_p2_site_visit_context_v1(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],jsonb,uuid,text,uuid,text[],integer,integer,integer,integer,integer,timestamp with time zone)'),
  ('private.agent_p2_site_visit_attention_v1(uuid,uuid,text,text[],jsonb,text,timestamp with time zone,timestamp with time zone,text[],boolean,timestamp with time zone,integer,integer)')
)
select protected.function_signature,
       procedure.oid as function_oid,
       pg_catalog.to_jsonb(procedure) - 'prosrc' as metadata,
       extensions.digest(
         pg_catalog.convert_to(procedure.prosrc, 'UTF8'),
         'sha256'
       ) as original_source_digest,
       pg_catalog.pg_get_functiondef(procedure.oid) as original_definition
from protected
join pg_catalog.pg_proc procedure
  on procedure.oid = pg_catalog.to_regprocedure(
    protected.function_signature
  )::oid;

do $site_visit_drift$
declare
  v_signature constant text :=
    'private.agent_p2_site_visit_list_v1(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],jsonb,text,timestamp with time zone,timestamp with time zone,text[],boolean,uuid,uuid,integer,integer,integer,timestamp with time zone,jsonb,timestamp with time zone,uuid,timestamp with time zone)';
  v_expected_fragment constant text :=
    '  with current_authority as materialized (';
  v_drifted_fragment constant text :=
    '  /* adversarial site-visit source drift */\n  with current_authority as materialized (';
  v_definition text;
  v_drifted_definition text;
  v_expected_count integer;
  v_drifted_count integer;
  v_guard_count integer;
  v_guard record;
  v_current record;
begin
  select pg_catalog.count(*)
    into strict v_guard_count
  from private.agent_site_visit_adversarial_guard;
  if v_guard_count is distinct from 3 then
    raise exception
      'agent_site_visit_adversarial_guard_count: %',
      v_guard_count;
  end if;

  select * into strict v_guard
  from private.agent_site_visit_adversarial_guard
  where function_signature = v_signature;

  select pg_catalog.pg_get_functiondef(
           pg_catalog.to_regprocedure(v_signature)::oid
         )
    into strict v_definition;
  v_expected_count := (
    pg_catalog.length(v_definition) - pg_catalog.length(
      pg_catalog.replace(v_definition, v_expected_fragment, '')
    )
  ) / pg_catalog.length(v_expected_fragment);
  v_drifted_count := (
    pg_catalog.length(v_definition) - pg_catalog.length(
      pg_catalog.replace(v_definition, v_drifted_fragment, '')
    )
  ) / pg_catalog.length(v_drifted_fragment);
  if v_expected_count is distinct from 1
     or v_drifted_count is distinct from 0 then
    raise exception
      'agent_site_visit_adversarial_setup_failed: % %',
      v_expected_count,
      v_drifted_count;
  end if;

  v_drifted_definition := pg_catalog.replace(
    v_definition,
    v_expected_fragment,
    v_drifted_fragment
  );
  execute v_drifted_definition;

  select procedure.oid as function_oid,
         pg_catalog.to_jsonb(procedure) - 'prosrc' as metadata,
         extensions.digest(
           pg_catalog.convert_to(procedure.prosrc, 'UTF8'),
           'sha256'
         ) as source_digest,
         procedure.prosrc
    into strict v_current
  from pg_catalog.pg_proc procedure
  where procedure.oid = pg_catalog.to_regprocedure(v_signature)::oid;

  if v_current.function_oid is distinct from v_guard.function_oid
     or v_current.metadata is distinct from v_guard.metadata
     or v_current.source_digest is not distinct from
          v_guard.original_source_digest
     or v_current.prosrc not like
          '%/* adversarial site-visit source drift */%' then
    raise exception 'agent_site_visit_adversarial_drift_failed';
  end if;
end;
$site_visit_drift$;
`;

const SITE_VISIT_ADVERSARIAL_VERIFY_SQL = `
do $site_visit_drift_verify$
declare
  v_guard record;
  v_current record;
  v_verified_count integer := 0;
begin
  for v_guard in
    select *
    from private.agent_site_visit_adversarial_guard
    order by function_signature collate "C"
  loop
    select procedure.oid as function_oid,
           pg_catalog.to_jsonb(procedure) - 'prosrc' as metadata,
           extensions.digest(
             pg_catalog.convert_to(procedure.prosrc, 'UTF8'),
             'sha256'
           ) as source_digest,
           procedure.prosrc
      into strict v_current
    from pg_catalog.pg_proc procedure
    where procedure.oid = pg_catalog.to_regprocedure(
      v_guard.function_signature
    )::oid;

    if v_current.function_oid is distinct from v_guard.function_oid
       or v_current.metadata is distinct from v_guard.metadata
       or v_guard.function_signature like
            'private.agent_p2_site_visit_list_v1(%'
          and (
            v_current.source_digest is not distinct from
              v_guard.original_source_digest
            or v_current.prosrc not like
              '%/* adversarial site-visit source drift */%'
          )
       or v_guard.function_signature not like
            'private.agent_p2_site_visit_list_v1(%'
          and (
            v_current.source_digest is distinct from
              v_guard.original_source_digest
            or v_current.prosrc like
              '%/* adversarial site-visit source drift */%'
          ) then
      raise exception
        'agent_site_visit_adversarial_abort_mutated_source: %',
        v_guard.function_signature;
    end if;
    v_verified_count := v_verified_count + 1;
  end loop;

  if v_verified_count is distinct from 3 then
    raise exception
      'agent_site_visit_adversarial_abort_count: %',
      v_verified_count;
  end if;
end;
$site_visit_drift_verify$;
`;

const SITE_VISIT_ADVERSARIAL_RESTORE_SQL = `
do $site_visit_restore$
declare
  v_signature constant text :=
    'private.agent_p2_site_visit_list_v1(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],jsonb,text,timestamp with time zone,timestamp with time zone,text[],boolean,uuid,uuid,integer,integer,integer,timestamp with time zone,jsonb,timestamp with time zone,uuid,timestamp with time zone)';
  v_guard record;
  v_current record;
  v_restored_count integer := 0;
begin
  select * into strict v_guard
  from private.agent_site_visit_adversarial_guard
  where function_signature = v_signature;
  execute v_guard.original_definition;

  for v_guard in
    select *
    from private.agent_site_visit_adversarial_guard
    order by function_signature collate "C"
  loop
    select procedure.oid as function_oid,
           pg_catalog.to_jsonb(procedure) - 'prosrc' as metadata,
           extensions.digest(
             pg_catalog.convert_to(procedure.prosrc, 'UTF8'),
             'sha256'
           ) as source_digest,
           procedure.prosrc
      into strict v_current
    from pg_catalog.pg_proc procedure
    where procedure.oid = pg_catalog.to_regprocedure(
      v_guard.function_signature
    )::oid;

    if v_current.function_oid is distinct from v_guard.function_oid
       or v_current.metadata is distinct from v_guard.metadata
       or v_current.source_digest is distinct from
            v_guard.original_source_digest
       or v_current.prosrc like
            '%/* adversarial site-visit source drift */%' then
      raise exception
        'agent_site_visit_adversarial_restore_failed: %',
        v_guard.function_signature;
    end if;
    v_restored_count := v_restored_count + 1;
  end loop;

  if v_restored_count is distinct from 3 then
    raise exception
      'agent_site_visit_adversarial_restore_count: %',
      v_restored_count;
  end if;

  drop table private.agent_site_visit_adversarial_guard;
end;
$site_visit_restore$;
`;

function assertSafeLocalPostgresTarget(host: string, port: string): void {
  let canonicalHost: string;
  try {
    canonicalHost = realpathSync.native(host);
  } catch {
    throw new Error("P2 PostgreSQL runtime requires a local temporary socket");
  }
  const localSocket =
    isAbsolute(host) &&
    (canonicalHost === "/tmp" ||
      canonicalHost.startsWith("/tmp/") ||
      canonicalHost === "/private/tmp" ||
      canonicalHost.startsWith("/private/tmp/"));
  if (!localSocket) {
    throw new Error("P2 PostgreSQL runtime requires a local temporary socket");
  }
  const numericPort = Number(port);
  if (
    !/^[0-9]{1,5}$/.test(port) ||
    !Number.isSafeInteger(numericPort) ||
    numericPort < 1 ||
    numericPort > 65_535 ||
    numericPort === 5_432
  ) {
    throw new Error("P2 PostgreSQL runtime requires a non-default test port");
  }
}

function databaseName(): string {
  return `p2_wave_${process.pid}_${randomBytes(6).toString("hex")}`;
}

function databaseArgs(database?: string): string[] {
  return ["-h", PG_HOST, "-p", PG_PORT, "-U", PG_USER].concat(
    database ? ["-d", database] : []
  );
}

async function runFile(
  database: string,
  file: string,
  variables: string[] = []
) {
  const args = databaseArgs(database).concat("-X", "-v", "ON_ERROR_STOP=1");
  for (const variable of variables) args.push("-v", variable);
  args.push("-f", file);
  await execFileAsync(PSQL, args, {
    cwd: ROOT,
    maxBuffer: 64 * 1024 * 1024,
    timeout: PSQL_TIMEOUT_MS,
    killSignal: "SIGTERM",
  });
}

async function expectMigrationSourceDrift(
  database: string,
  migrationName: string,
  expectedMarker: string,
  expectedSqlState?: string
): Promise<void> {
  const replayError = await runFile(
    database,
    join(ROOT, "supabase/migrations", migrationName),
    ["VERBOSITY=verbose"]
  ).catch((error: unknown) => error);
  expect(replayError).toBeInstanceOf(Error);
  const stderr = String(
    (replayError as { readonly stderr?: unknown }).stderr ?? replayError
  );
  expect(stderr).toContain(expectedMarker);
  if (expectedSqlState) {
    expect(stderr).toContain(`ERROR:  ${expectedSqlState}: ${expectedMarker}`);
  }
}

async function runStatement(database: string, sql: string) {
  await execFileAsync(
    PSQL,
    databaseArgs(database).concat("-X", "-v", "ON_ERROR_STOP=1", "-c", sql),
    {
      cwd: ROOT,
      maxBuffer: 64 * 1024 * 1024,
      timeout: PSQL_TIMEOUT_MS,
      killSignal: "SIGTERM",
    }
  );
}

async function queryScalar(database: string, sql: string): Promise<string> {
  const { stdout } = await execFileAsync(
    PSQL,
    databaseArgs(database).concat("-X", "-Atqc", sql),
    {
      cwd: ROOT,
      maxBuffer: 64 * 1024 * 1024,
      timeout: LIFECYCLE_TIMEOUT_MS,
      killSignal: "SIGTERM",
    }
  );
  return stdout.trim();
}

async function createDatabase(
  database: string,
  localeArgs: readonly string[] = []
) {
  await execFileAsync(
    CREATEDB,
    databaseArgs().concat(
      "-T",
      "template0",
      "-E",
      "UTF8",
      ...localeArgs,
      database
    ),
    {
      cwd: ROOT,
      timeout: LIFECYCLE_TIMEOUT_MS,
      killSignal: "SIGTERM",
    }
  );
}

async function runFixtureGroup(
  database: string,
  group: readonly string[],
  executedFixtures: Set<string>
) {
  for (const fixture of fixtureExecutionPlan(group)) {
    const variables = fixture.includes("manifest-v8")
      ? ["agent_mcp_manifest_v8_bootstrap=0"]
      : [];
    await runFile(database, join(ROOT, "tests/sql", fixture), variables);
    executedFixtures.add(fixture);
  }
}

function fixtureExecutionPlan(group: readonly string[]): readonly string[] {
  if (group.length === 1) return group;
  if (group.length === 2) return [group[0], group[1], group[0]];
  if (group.length === 3) return [group[0], group[1], group[2], group[1]];
  throw new Error(`unsupported P2 fixture group length: ${group.length}`);
}

async function dropDatabase(database: string) {
  if (!/^p2_wave_[0-9]+_[0-9a-f]{12}$/.test(database)) {
    throw new Error(`refusing to drop non-P2 database: ${database}`);
  }
  await execFileAsync(
    DROPDB,
    databaseArgs().concat("--if-exists", "--force", database),
    { cwd: ROOT, timeout: LIFECYCLE_TIMEOUT_MS, killSignal: "SIGTERM" }
  );
}

type PrimaryOutcome =
  | { readonly failed: false }
  | { readonly failed: true; readonly error: unknown };

async function settleWithCleanup(
  primary: PrimaryOutcome,
  cleanup: (() => Promise<void>) | undefined
): Promise<void> {
  let cleanupOutcome: PrimaryOutcome = { failed: false };
  if (cleanup) {
    try {
      await cleanup();
    } catch (error) {
      cleanupOutcome = { failed: true, error };
    }
  }

  if (primary.failed && cleanupOutcome.failed) {
    throw new AggregateError(
      [primary.error, cleanupOutcome.error],
      "P2 PostgreSQL runtime and disposable database cleanup both failed"
    );
  }
  if (primary.failed) throw primary.error;
  if (cleanupOutcome.failed) throw cleanupOutcome.error;
}

describe("P2 PostgreSQL 17 full-wave ledger", () => {
  it("pins the exact ordered 45-file ledger and canonical baseline", async () => {
    expect(MIGRATIONS).toHaveLength(45);
    expect(new Set(MIGRATIONS.map(([name]) => name)).size).toBe(45);
    expect(FIXTURE_GROUPS.flat()).toHaveLength(53);
    expect(FIXTURES).toHaveLength(53);
    expect(FIXTURE_GROUPS.flat()).toEqual(FIXTURES.map(([name]) => name));
    expect(FIXTURE_CHECKPOINT_MIGRATIONS).toHaveLength(FIXTURE_GROUPS.length);
    expect(new Set(FIXTURE_CHECKPOINT_MIGRATIONS).size).toBe(
      FIXTURE_CHECKPOINT_MIGRATIONS.length
    );
    const migrationNames = MIGRATIONS.map(([name]) => name);
    const checkpointIndexes = FIXTURE_CHECKPOINT_MIGRATIONS.map((name) =>
      migrationNames.indexOf(name)
    );
    expect(
      checkpointIndexes.every(
        (index, position) =>
          index >= 0 &&
          (position === 0 || index > checkpointIndexes[position - 1])
      )
    ).toBe(true);
    expect(new Set(FIXTURE_GROUPS.flat()).size).toBe(53);
    expect(new Set(FIXTURES.map(([name]) => name)).size).toBe(53);
    expect(FIXTURE_GROUPS.every((group) => group.length <= 3)).toBe(true);
    expect(fixtureExecutionPlan(FIXTURE_GROUPS[11])).toEqual([
      "agent-sales-document-sources-runtime.sql",
      "agent-sales-document-reads-runtime.sql",
      "agent-sales-document-reads-replay-runtime.sql",
      "agent-sales-document-reads-runtime.sql",
    ]);
    expect(fixtureExecutionPlan(FIXTURE_GROUPS[14])).toEqual([
      "agent-catalog-sources-runtime.sql",
      "agent-catalog-reads-runtime.sql",
      "agent-catalog-reads-replay-runtime.sql",
      "agent-catalog-reads-runtime.sql",
    ]);
    expect(MIGRATIONS.slice(-3).map(([name]) => name)).toEqual([
      "20260830150000_agent_mcp_financial_tombstones.sql",
      "20260830160000_agent_mcp_postgres_uuid_compatibility.sql",
      "20260830170000_agent_site_visit_nullable_client_visibility.sql",
    ]);
    expect(FIXTURE_CHECKPOINT_MIGRATIONS.slice(-3)).toEqual([
      "20260830150000_agent_mcp_financial_tombstones.sql",
      "20260830160000_agent_mcp_postgres_uuid_compatibility.sql",
      "20260830170000_agent_site_visit_nullable_client_visibility.sql",
    ]);
    expect(fixtureExecutionPlan(FIXTURE_GROUPS[25])).toEqual([
      "agent-mcp-scope-canonical-order-runtime.sql",
      "agent-mcp-scope-canonical-order-replay-runtime.sql",
      "agent-mcp-scope-canonical-order-runtime.sql",
    ]);
    expect(fixtureExecutionPlan(FIXTURE_GROUPS[26])).toEqual([
      "agent-mcp-financial-tombstone-runtime.sql",
      "agent-mcp-financial-tombstone-replay-runtime.sql",
      "agent-mcp-financial-tombstone-runtime.sql",
    ]);
    expect(fixtureExecutionPlan(FIXTURE_GROUPS[27])).toEqual([
      "agent-mcp-postgres-uuid-runtime.sql",
      "agent-mcp-postgres-uuid-replay-runtime.sql",
      "agent-mcp-postgres-uuid-runtime.sql",
    ]);
    expect(fixtureExecutionPlan(FIXTURE_GROUPS[28])).toEqual([
      "agent-site-visit-nullable-client-runtime.sql",
      "agent-site-visit-nullable-client-replay-runtime.sql",
      "agent-site-visit-nullable-client-runtime.sql",
    ]);
    expect(() => assertSafeLocalPostgresTarget("/tmp", "55414")).not.toThrow();
    expect(() =>
      assertSafeLocalPostgresTarget("/private/tmp", "55414")
    ).not.toThrow();
    expect(() => assertSafeLocalPostgresTarget("db.ops.test", "55414")).toThrow(
      "local temporary socket"
    );
    expect(() => assertSafeLocalPostgresTarget("/tmp", "5432")).toThrow(
      "non-default test port"
    );
    expect(() => assertSafeLocalPostgresTarget("/tmp", "65536")).toThrow(
      "non-default test port"
    );
    expect(() => assertSafeLocalPostgresTarget("/tmp", "0")).toThrow(
      "non-default test port"
    );
    expect(() =>
      assertSafeLocalPostgresTarget("/tmp/../var/run/postgresql", "55414")
    ).toThrow("local temporary socket");

    const primaryFailure = new Error("primary failure");
    const cleanupFailure = new Error("cleanup failure");
    const aggregate = await settleWithCleanup(
      { failed: true, error: primaryFailure },
      async () => {
        throw cleanupFailure;
      }
    ).catch((error: unknown) => error);
    expect(aggregate).toBeInstanceOf(AggregateError);
    expect((aggregate as AggregateError).errors).toEqual([
      primaryFailure,
      cleanupFailure,
    ]);
    await expect(
      settleWithCleanup({ failed: false }, async () => {
        throw cleanupFailure;
      })
    ).rejects.toBe(cleanupFailure);
    let caughtUndefinedCleanup = false;
    try {
      await settleWithCleanup({ failed: false }, async () => {
        throw undefined;
      });
    } catch (error) {
      caughtUndefinedCleanup = true;
      expect(error).toBeUndefined();
    }
    expect(caughtUndefinedCleanup).toBe(true);
    expect(PSQL_TIMEOUT_MS).toBe(120_000);
    expect(LIFECYCLE_TIMEOUT_MS).toBe(30_000);
    await expect(readFile(RUNNER_FILE, "utf8")).resolves.not.toContain(
      ["process", "cwd()"].join(".")
    );

    const baselineBytes = await readFile(BASELINE);
    expect(baselineBytes.toString("utf8")).toContain(
      "agent_p2_full_wave_baseline_ready"
    );
    expect(createHash("sha256").update(baselineBytes).digest("hex")).toBe(
      BASELINE_SHA256
    );

    for (const [name, expectedHash] of MIGRATIONS) {
      const bytes = await readFile(join(ROOT, "supabase/migrations", name));
      expect(createHash("sha256").update(bytes).digest("hex"), name).toBe(
        expectedHash
      );
    }
    for (const [name, expectedHash] of BASELINE_PREREQUISITES) {
      const bytes = await readFile(join(ROOT, "supabase/migrations", name));
      expect(createHash("sha256").update(bytes).digest("hex"), name).toBe(
        expectedHash
      );
    }
    for (const [name, expectedHash] of FIXTURES) {
      const bytes = await readFile(join(ROOT, "tests/sql", name));
      expect(createHash("sha256").update(bytes).digest("hex"), name).toBe(
        expectedHash
      );
    }
  });

  describe.runIf(RUN_POSTGRES)("live disposable database", () => {
    it(
      "applies the exact wave and keeps all runtime and replay proofs green",
      async () => {
        const database = databaseName();
        let created = false;
        let primary: PrimaryOutcome = { failed: false };
        const appliedMigrations: string[] = [];
        const executedFixtures = new Set<string>();
        try {
          assertSafeLocalPostgresTarget(PG_HOST, PG_PORT);
          const { stdout: version } = await execFileAsync(
            PSQL,
            databaseArgs("postgres").concat(
              "-X",
              "-Atqc",
              "show server_version_num"
            ),
            {
              cwd: ROOT,
              timeout: LIFECYCLE_TIMEOUT_MS,
              killSignal: "SIGTERM",
            }
          );
          expect(Number(version.trim())).toBeGreaterThanOrEqual(170000);
          expect(Number(version.trim())).toBeLessThan(180000);

          const { stdout: roles } = await execFileAsync(
            PSQL,
            databaseArgs("postgres").concat(
              "-X",
              "-Atqc",
              `select coalesce(
                 pg_catalog.string_agg(
                   role.rolname || ':' ||
                   role.rolcanlogin::text || ':' ||
                   role.rolsuper::text || ':' ||
                   role.rolinherit::text || ':' ||
                   role.rolbypassrls::text || ':' ||
                   role.rolcreaterole::text || ':' ||
                   role.rolcreatedb::text || ':' ||
                   role.rolreplication::text,
                   ',' order by role.rolname collate "C"
                 ),
                 ''
               )
               from pg_catalog.pg_roles as role
               where role.rolname = any (
                 array['anon', 'authenticated', 'service_role']::text[]
               )`
            ),
            {
              cwd: ROOT,
              timeout: LIFECYCLE_TIMEOUT_MS,
              killSignal: "SIGTERM",
            }
          );
          expect(roles.trim()).toBe(
            "anon:false:false:true:false:false:false:false," +
              "authenticated:false:false:true:false:false:false:false," +
              "service_role:false:false:true:true:false:false:false"
          );

          // The generated name is already closed and collision-resistant. Mark
          // cleanup eligible before CREATEDB starts so a server-side success
          // followed by a client timeout cannot strand a disposable database.
          created = true;
          await createDatabase(database);
          await runFile(database, BASELINE);
          appliedMigrations.push(MIGRATIONS[0][0]);
          await runFixtureGroup(database, FIXTURE_GROUPS[0], executedFixtures);

          // The canonical baseline installs migration 1 through its existing
          // v6/v7/v8 continuity fixture; the remaining files apply here in
          // their immutable ledger order. Each fixture group executes at its
          // last migration dependency, before later domain triggers can alter
          // the historical slice contract it is proving.
          for (const [name] of MIGRATIONS.slice(1)) {
            if (
              name ===
              "20260830170000_agent_site_visit_nullable_client_visibility.sql"
            ) {
              await runStatement(database, SITE_VISIT_ADVERSARIAL_DRIFT_SQL);
              await expectMigrationSourceDrift(
                database,
                name,
                "agent_site_visit_nullable_client_source_drift",
                "55000"
              );
              await runStatement(database, SITE_VISIT_ADVERSARIAL_VERIFY_SQL);
              await runStatement(database, SITE_VISIT_ADVERSARIAL_RESTORE_SQL);
            }
            await runFile(database, join(ROOT, "supabase/migrations", name));
            appliedMigrations.push(name);
            const checkpointIndex = FIXTURE_CHECKPOINT_MIGRATIONS.indexOf(
              name as (typeof FIXTURE_CHECKPOINT_MIGRATIONS)[number]
            );
            if (checkpointIndex >= 0) {
              await runFixtureGroup(
                database,
                FIXTURE_GROUPS[checkpointIndex],
                executedFixtures
              );
            }
            if (name === "20260823072843_agent_mcp_durable_rate_limit.sql") {
              await runStatement(
                database,
                RELEASE_BOOTSTRAP_OAUTH_SENTINELS_SQL
              );
            }
            if (name === "20260830140000_agent_mcp_scope_canonical_order.sql") {
              await runStatement(
                database,
                SCOPE_CANONICAL_ORDER_ADVERSARIAL_DRIFT_SQL
              );
              await expectMigrationSourceDrift(
                database,
                name,
                "agent_mcp_scope_canonical_order_source_drift"
              );
              await runStatement(
                database,
                SCOPE_CANONICAL_ORDER_ADVERSARIAL_RESTORE_SQL
              );
              await runFile(database, join(ROOT, "supabase/migrations", name));
            }
            if (name === "20260830150000_agent_mcp_financial_tombstones.sql") {
              await runStatement(
                database,
                FINANCIAL_TOMBSTONE_ADVERSARIAL_DRIFT_SQL
              );
              await expectMigrationSourceDrift(
                database,
                name,
                "agent_mcp_financial_tombstone_source_drift"
              );
              await runStatement(
                database,
                FINANCIAL_TOMBSTONE_ADVERSARIAL_RESTORE_SQL
              );
              await runFile(database, join(ROOT, "supabase/migrations", name));
            }
            if (
              name ===
              "20260830160000_agent_mcp_postgres_uuid_compatibility.sql"
            ) {
              await runStatement(database, POSTGRES_UUID_ADVERSARIAL_DRIFT_SQL);
              await expectMigrationSourceDrift(
                database,
                name,
                "agent_mcp_postgres_uuid_source_drift"
              );
              await runStatement(
                database,
                POSTGRES_UUID_ADVERSARIAL_RESTORE_SQL
              );
              await runFile(database, join(ROOT, "supabase/migrations", name));
            }
          }

          expect(appliedMigrations).toEqual(MIGRATIONS.map(([name]) => name));
          expect([...executedFixtures].sort()).toEqual(
            [...FIXTURE_GROUPS.flat()].sort()
          );

          await runStatement(database, SCOPE_SET_BINDING_ADVERSARIAL_DRIFT_SQL);
          await expectMigrationSourceDrift(
            database,
            "20260830120000_agent_mcp_scope_set_binding.sql",
            "agent_mcp_scope_set_binding_source_drift"
          );
        } catch (error) {
          primary = { failed: true, error };
        }
        await settleWithCleanup(
          primary,
          created ? () => dropDatabase(database) : undefined
        );
      },
      20 * 60 * 1000
    );

    it(
      "applies consent and scope canonical order under production ICU ordering",
      async () => {
        const database = databaseName();
        let created = false;
        let primary: PrimaryOutcome = { failed: false };
        try {
          assertSafeLocalPostgresTarget(PG_HOST, PG_PORT);
          created = true;
          await createDatabase(database, [
            "--locale-provider=icu",
            `--icu-locale=${PRODUCTION_DATABASE_LOCALE}`,
          ]);

          expect(
            await queryScalar(
              database,
              `select datlocprovider::text || ':' || datlocale
               from pg_catalog.pg_database
               where datname = current_database()`
            )
          ).toBe(
            `${PRODUCTION_DATABASE_LOCALE_PROVIDER}:${PRODUCTION_DATABASE_LOCALE}`
          );
          expect(
            await queryScalar(
              database,
              `select pg_catalog.string_agg(signature, '|' order by signature)
               from (values
                 ('private.mcp_oauth_scope_array(text)'),
                 ('private.mcp_oauth_scope_array_is_valid(text[])')
               ) expected(signature)`
            )
          ).toBe(
            "private.mcp_oauth_scope_array_is_valid(text[])|" +
              "private.mcp_oauth_scope_array(text)"
          );
          expect(
            await queryScalar(
              database,
              `select pg_catalog.string_agg(signature, '|' order by proname)
               from (values
                 ('mcp_oauth_scope_array',
                  'private.mcp_oauth_scope_array(text)'),
                 ('mcp_oauth_scope_array_is_valid',
                  'private.mcp_oauth_scope_array_is_valid(text[])')
               ) actual(proname, signature)`
            )
          ).toBe(
            "private.mcp_oauth_scope_array(text)|" +
              "private.mcp_oauth_scope_array_is_valid(text[])"
          );

          await runFile(database, BASELINE);
          const scopeCanonicalOrderIndex = MIGRATIONS.findIndex(
            ([name]) =>
              name === "20260830140000_agent_mcp_scope_canonical_order.sql"
          );
          expect(scopeCanonicalOrderIndex).toBeGreaterThan(2);
          for (const [name] of MIGRATIONS.slice(
            1,
            scopeCanonicalOrderIndex + 1
          )) {
            await runFile(database, join(ROOT, "supabase/migrations", name));
            if (
              name === "20260823072837_mcp_oauth_consent_catalog_versioning.sql"
            ) {
              await runFile(
                database,
                join(
                  ROOT,
                  "tests/sql",
                  "agent-mcp-oauth-consent-catalog-runtime.sql"
                )
              );
            }
            if (name === "20260823072843_agent_mcp_durable_rate_limit.sql") {
              await runStatement(
                database,
                RELEASE_BOOTSTRAP_OAUTH_SENTINELS_SQL
              );
            }
          }
          expect(MIGRATIONS[scopeCanonicalOrderIndex][0]).toBe(
            "20260830140000_agent_mcp_scope_canonical_order.sql"
          );
          await runFile(
            database,
            join(
              ROOT,
              "tests/sql",
              "agent-mcp-scope-canonical-order-runtime.sql"
            )
          );
          await runFile(
            database,
            join(
              ROOT,
              "tests/sql",
              "agent-mcp-scope-canonical-order-replay-runtime.sql"
            )
          );
          await runFile(
            database,
            join(
              ROOT,
              "tests/sql",
              "agent-mcp-scope-canonical-order-runtime.sql"
            )
          );
        } catch (error) {
          primary = { failed: true, error };
        }
        await settleWithCleanup(
          primary,
          created ? () => dropDatabase(database) : undefined
        );
      },
      5 * 60 * 1000
    );
  });
});
