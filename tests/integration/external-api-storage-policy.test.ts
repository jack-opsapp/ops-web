// @vitest-environment node

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  DEFAULT_SCHEMA: defaultYamlSchema,
  Type: YamlType,
  load: parseYaml,
} = require("js-yaml") as {
  DEFAULT_SCHEMA: {
    extend(types: unknown[]): unknown;
  };
  Type: new (
    tag: string,
    options: {
      construct(value: unknown): unknown;
      kind: "scalar" | "sequence";
    }
  ) => unknown;
  load(source: string, options?: { schema?: unknown }): unknown;
};

const templatePath = path.join(
  process.cwd(),
  "infra",
  "external-intake-storage.yaml"
);
const cloudFormationSchema = defaultYamlSchema.extend([
  new YamlType("!Ref", {
    kind: "scalar",
    construct: (value) => ({ Ref: value }),
  }),
  new YamlType("!Sub", {
    kind: "scalar",
    construct: (value) => ({ "Fn::Sub": value }),
  }),
  new YamlType("!GetAtt", {
    kind: "scalar",
    construct: (value) => ({ "Fn::GetAtt": value }),
  }),
  new YamlType("!Join", {
    kind: "sequence",
    construct: (value) => ({ "Fn::Join": value }),
  }),
]);

function template(): string {
  return readFileSync(templatePath, "utf8");
}

function parsedTemplate() {
  return parseYaml(template(), { schema: cloudFormationSchema }) as {
    Resources: Record<
      string,
      {
        Properties?: {
          PolicyDocument?: {
            Statement?: Array<{
              Action?: string | string[];
              Condition?: Record<string, unknown>;
              Sid?: string;
            }>;
          };
        };
      }
    >;
  };
}

function resourceBlock(source: string, logicalId: string, nextId: string) {
  const start = source.indexOf(`  ${logicalId}:`);
  const end = source.indexOf(`  ${nextId}:`, start + 1);
  expect(start, `${logicalId} must exist`).toBeGreaterThanOrEqual(0);
  expect(end, `${nextId} must follow ${logicalId}`).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("external intake storage infrastructure policy", () => {
  it("defines one private, owner-enforced, encrypted, versioned intake bucket", () => {
    const source = template();
    const bucket = resourceBlock(
      source,
      "ExternalIntakeBucket",
      "UploadEventsDeadLetterQueue"
    );

    expect(bucket).toContain("Type: AWS::S3::Bucket");
    expect(bucket).toContain("BucketOwnerEnforced");
    expect(bucket).toContain("BlockPublicAcls: true");
    expect(bucket).toContain("BlockPublicPolicy: true");
    expect(bucket).toContain("IgnorePublicAcls: true");
    expect(bucket).toContain("RestrictPublicBuckets: true");
    expect(bucket).toContain("BucketEncryption:");
    expect(bucket).toContain("SSEAlgorithm: AES256");
    expect(bucket).toContain("VersioningConfiguration:");
    expect(bucket).toContain("Status: Enabled");
    expect(bucket).toContain("quarantine/");
    expect(bucket).toContain("accepted-original/");
    expect(bucket).toContain("safe-derivative/");
    expect(source).not.toMatch(/AccessControl:\s*PublicRead/);
  });

  it("uses only S3-supported characters in bucket tags", () => {
    const bucket = resourceBlock(
      template(),
      "ExternalIntakeBucket",
      "UploadEventsDeadLetterQueue"
    );
    const tagsStart = bucket.indexOf("      Tags:");
    const parsed = parseYaml(
      bucket.slice(tagsStart).replace(/^ {6}/gm, "")
    ) as {
      Tags?: Array<{ Key?: string; Value?: string }>;
    };
    const allowedS3TagCharacters = /^[A-Za-z0-9 _.:/=+\-@]*$/;

    expect(parsed.Tags).toBeDefined();
    for (const tag of parsed.Tags ?? []) {
      expect(tag.Key).toMatch(allowedS3TagCharacters);
      expect(tag.Value).toMatch(allowedS3TagCharacters);
    }
  });

  it("allows credentialless browser PUT/HEAD transport without browser reads", () => {
    const bucket = resourceBlock(
      template(),
      "ExternalIntakeBucket",
      "UploadEventsDeadLetterQueue"
    );
    const corsStart = bucket.indexOf("CorsConfiguration:");
    const corsEnd = bucket.indexOf("LifecycleConfiguration:");
    const cors = bucket.slice(corsStart, corsEnd);

    expect(cors).toContain("AllowedOrigins:");
    expect(cors).toContain('- "*"');
    expect(cors).toContain("- PUT");
    expect(cors).toContain("- HEAD");
    expect(cors).not.toContain("- GET");
    expect(cors).not.toContain("- DELETE");
    expect(cors).toContain("- content-length");
    expect(cors).toContain("- content-type");
    expect(cors).toContain("- if-none-match");
    expect(cors).toContain("- x-amz-checksum-sha256");
    expect(cors).toContain("- ETag");
    expect(cors).toContain("- x-amz-version-id");
  });

  it("keeps terminal cleanup behind capability expiry plus skew and a durable fallback", () => {
    const source = template();
    const bucket = resourceBlock(
      source,
      "ExternalIntakeBucket",
      "UploadEventsDeadLetterQueue"
    );

    expect(source).toContain("upload-capability-delete-not-before");
    expect(source).toContain("cleanup=eligible");
    expect(bucket).toContain("ExpirationInDays: 1");
    expect(bucket).toContain("NoncurrentVersionExpiration:");
    expect(bucket).toContain("NoncurrentDays: 1");
    expect(source).toContain("application cleanup is authoritative");
  });

  it("gives the upload signer one conditional create-only permission", () => {
    const source = template();
    const signer = resourceBlock(
      source,
      "ExternalIntakeUploadSignerPolicy",
      "ExternalIntakeWorkerUser"
    );

    expect(signer).toContain("- s3:PutObject");
    expect(signer).toContain("quarantine/*");
    expect(signer).toContain("s3:if-none-match");
    expect(signer).toContain('"*"');
    expect(signer).not.toContain("s3:GetObject");
    expect(signer).not.toContain("s3:ListBucket");
    expect(signer).not.toContain("s3:DeleteObject");
  });

  it("independently denies a PUT that omits the create-only condition", () => {
    const source = template();
    const policy = resourceBlock(
      source,
      "ExternalIntakeBucketPolicy",
      "GuardDutyMalwareProtectionRole"
    );

    expect(policy).toContain("Sid: DenyMissingConditionalWrite");
    expect(policy).toContain("Effect: Deny");
    expect(policy).toContain("Action: s3:PutObject");
    expect(policy).toContain("s3:if-none-match");
    expect(policy).toContain('"true"');
  });

  it("parses the missing-condition guard with the exact IAM Null operator", () => {
    const policy = resourceBlock(
      template(),
      "ExternalIntakeBucketPolicy",
      "GuardDutyMalwareProtectionRole"
    );
    const statementStart = policy.indexOf(
      "          - Sid: DenyMissingConditionalWrite"
    );
    const conditionStart = policy.indexOf(
      "            Condition:",
      statementStart
    );
    const nextStatement = policy.indexOf("          - Sid:", conditionStart);
    const conditionSource = policy
      .slice(conditionStart, nextStatement)
      .replace(/^ {12}/gm, "");
    const parsed = parseYaml(conditionSource) as {
      Condition?: Record<string, unknown>;
    };

    expect(parsed.Condition).toHaveProperty("Null");
  });

  it("gives the private worker exact-version erasure and invalidation access", () => {
    const source = template();
    const worker = resourceBlock(
      source,
      "ExternalIntakeWorkerPolicy",
      "ExternalIntakeBucketPolicy"
    );

    expect(worker).toContain("s3:GetObjectVersion");
    expect(worker).toContain("s3:DeleteObjectVersion");
    expect(worker).not.toContain("- s3:DeleteObject\n");
    expect(worker).toContain("cloudfront:CreateInvalidation");
    expect(worker).not.toContain("cloudfront:GetInvalidation");
    expect(worker).not.toContain("s3:ListBucket");
  });

  it("delivers S3 arrivals and GuardDuty scan results to queues with DLQs", () => {
    const source = template();

    expect(source).toContain("UploadEventsDeadLetterQueue");
    expect(source).toContain("UploadEventsQueue");
    expect(source).toContain("ScanResultsDeadLetterQueue");
    expect(source).toContain("ScanResultsQueue");
    expect(source.match(/RedrivePolicy:/g)).toHaveLength(2);
    expect(source).toContain("s3:ObjectCreated:*");
    expect(source).toContain("GuardDuty Malware Protection Object Scan Result");
    expect(source).toContain("source:");
    expect(source).toContain("- aws.guardduty");

    const rule =
      parsedTemplate().Resources.GuardDutyScanResultsRule.Properties;
    expect(rule.EventPattern?.detail?.s3ObjectDetails?.objectKey).toEqual([
      { prefix: "quarantine/" },
    ]);
  });

  it("limits GuardDuty to the quarantine prefix and enables managed tagging", () => {
    const source = template();
    const plan = resourceBlock(
      source,
      "ExternalIntakeMalwareProtectionPlan",
      "ExternalIntakeSigningPublicKey"
    );

    expect(plan).toContain("Type: AWS::GuardDuty::MalwareProtectionPlan");
    expect(plan).toContain("ObjectPrefixes:");
    expect(plan).toContain("- quarantine/");
    expect(plan).not.toContain("- accepted-original/");
    expect(plan).not.toContain("- safe-derivative/");
    expect(plan).toContain("Tagging:");
    expect(plan).toContain("Status: ENABLED");
    expect(source).toContain("EventBridgeEnabled: true");
    expect(source).toContain("s3:PutObjectVersionTagging");
    expect(source).toContain("malware-protection-resource-validation-object");
    expect(source).toContain(
      "events:ManagedBy: malware-protection-plan.guardduty.amazonaws.com"
    );
  });

  it("allows GuardDuty to validate bucket ownership without a prefix condition", () => {
    const statements =
      parsedTemplate().Resources.GuardDutyMalwareProtectionRolePolicy.Properties
        ?.PolicyDocument?.Statement ?? [];
    const ownership = statements.find(
      (statement) => statement.Sid === "AllowCheckBucketOwnership"
    );

    expect(ownership).toBeDefined();
    expect(ownership?.Action).toEqual([
      "s3:ListBucket",
      "s3:GetBucketLocation",
    ]);
    expect(ownership).not.toHaveProperty("Condition");
  });

  it("uses OAC, trusted keys, zero caching, and separate delivery behaviors", () => {
    const source = template();

    expect(source).toContain("Type: AWS::CloudFront::OriginAccessControl");
    expect(source).toContain("SigningBehavior: always");
    expect(source).toContain("SigningProtocol: sigv4");
    expect(source).toContain("Type: AWS::CloudFront::KeyGroup");
    expect(source).toContain("TrustedKeyGroups:");
    expect(source).toContain("PathPattern: safe-derivative/*");
    expect(source).toContain("PathPattern: accepted-original/*");
    expect(source).toContain("Content-Disposition");
    expect(source).toContain("Value: attachment");
    expect(source).toContain("Content-Type");
    expect(source).toContain("Value: application/octet-stream");
    expect(source).toContain("ContentTypeOptions:");
    expect(source).toContain("ContentSecurityPolicy:");
    expect(source).toContain("DefaultTTL: 0");
    expect(source).toContain("MinTTL: 0");
    expect(source).toContain("MaxTTL: 0");
    expect(source).toContain("Cache-Control");
    expect(source).toContain("private, no-store, max-age=0");
  });

  it("reconstructs a multiline CloudFront public key from a console-safe list", () => {
    const source = template();
    const parameterStart = source.indexOf("  CloudFrontPublicKeyEncoded:");
    const resourcesStart = source.indexOf("\nResources:", parameterStart);
    const parameter = parseYaml(
      `Parameter:\n${source.slice(parameterStart, resourcesStart)}`
    ) as {
      Parameter?: {
        CloudFrontPublicKeyEncoded?: {
          Type?: string;
        };
      };
    };
    const publicKey = resourceBlock(
      source,
      "ExternalIntakeSigningPublicKey",
      "ExternalIntakeSigningKeyGroup"
    );

    expect(parameter.Parameter?.CloudFrontPublicKeyEncoded?.Type).toBe(
      "CommaDelimitedList"
    );
    expect(publicKey).toContain(
      'EncodedKey: !Join ["\\n", !Ref CloudFrontPublicKeyEncoded]'
    );
  });

  it("denies CloudFront reads unless both scan and acceptance tags are present", () => {
    const policy = resourceBlock(
      template(),
      "ExternalIntakeBucketPolicy",
      "GuardDutyMalwareProtectionRole"
    );

    expect(policy).toContain("s3:ExistingObjectTag/GuardDutyMalwareScanStatus");
    expect(policy).toContain("NO_THREATS_FOUND");
    expect(policy).toContain("s3:ExistingObjectTag/ops-disposition");
    expect(policy).toContain("accepted");
  });

  it("emits the exact non-secret application environment outputs", () => {
    const source = template();
    for (const name of [
      "EXTERNAL_INTAKE_AWS_REGION",
      "EXTERNAL_INTAKE_S3_BUCKET",
      "EXTERNAL_INTAKE_UPLOAD_QUEUE_URL",
      "EXTERNAL_INTAKE_SCAN_QUEUE_URL",
      "EXTERNAL_INTAKE_CLOUDFRONT_DOMAIN",
      "EXTERNAL_INTAKE_CLOUDFRONT_DISTRIBUTION_ID",
      "EXTERNAL_INTAKE_CLOUDFRONT_KEY_PAIR_ID",
      "EXTERNAL_INTAKE_CLOUDFRONT_PRIVATE_KEY",
    ]) {
      expect(source).toContain(name);
    }
    expect(source).toContain("ExternalIntakeUploadSignerUserName");
    expect(source).toContain("ExternalIntakeWorkerUserName");
    expect(source).not.toContain("BEGIN PRIVATE KEY");
    expect(source).not.toContain("SecretAccessKey:");
  });
});
