import "server-only";

import externalApiDocument from "../../../../docs/api/openapi-v1.json";

type JsonObject = Record<string, unknown>;
type HttpMethod = "get" | "post";

export const EXTERNAL_API_REFERENCE_OPERATION_IDS = [
  "getIntakeConfig",
  "createUploadBatch",
  "createIntakeSubmission",
  "getIntakeSubmission",
  "getLeadFeed",
  "getLeadMetrics",
] as const;

export type ExternalApiReferenceOperationId =
  (typeof EXTERNAL_API_REFERENCE_OPERATION_IDS)[number];

export interface ExternalApiReferenceField {
  name: string;
  type: string;
  required: boolean;
  description: string | null;
  constraints: string[];
}

export interface ExternalApiReferenceParameter extends ExternalApiReferenceField {
  location: "header" | "path" | "query";
}

export interface ExternalApiReferenceBody {
  required: boolean;
  schemaName: string;
  fields: ExternalApiReferenceField[];
  example: unknown;
}

export interface ExternalApiReferenceResponse {
  status: string;
  description: string;
  schemaName: string;
  fields: ExternalApiReferenceField[];
  example: unknown;
}

export interface ExternalApiReferenceOperation {
  operationId: ExternalApiReferenceOperationId;
  method: HttpMethod;
  path: string;
  summary: string;
  description: string;
  requiredScopes: string[];
  parameters: ExternalApiReferenceParameter[];
  request: ExternalApiReferenceBody | null;
  successResponses: ExternalApiReferenceResponse[];
  errorStatuses: string[];
}

export interface ExternalApiOpenApiDocument extends JsonObject {
  openapi: string;
  info: JsonObject;
  servers: JsonObject[];
  paths: Record<string, Record<string, unknown>>;
  components: {
    schemas: Record<string, JsonObject>;
  } & JsonObject;
}

export interface ExternalApiReference {
  document: ExternalApiOpenApiDocument;
  openApiVersion: string;
  apiVersion: string;
  title: string;
  description: string;
  baseUrl: string;
  operations: ExternalApiReferenceOperation[];
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireObject(value: unknown, label: string): JsonObject {
  if (!isObject(value)) {
    throw new Error(`Invalid external API OpenAPI ${label}`);
  }
  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Invalid external API OpenAPI ${label}`);
  }
  return value;
}

function referenceName(value: unknown, label: string): string {
  const schema = requireObject(value, label);
  const reference = requireString(schema.$ref, `${label} reference`);
  const prefix = "#/components/schemas/";
  if (!reference.startsWith(prefix) || reference.length === prefix.length) {
    throw new Error(`Invalid external API OpenAPI ${label} reference`);
  }
  return reference.slice(prefix.length);
}

function schemaType(schema: JsonObject): string {
  if (typeof schema.type === "string") return schema.type;
  if (typeof schema.$ref === "string") {
    return schema.$ref.slice(schema.$ref.lastIndexOf("/") + 1);
  }
  if (Array.isArray(schema.oneOf)) return "oneOf";
  if (Array.isArray(schema.anyOf)) return "anyOf";
  return "unknown";
}

function schemaConstraints(schema: JsonObject): string[] {
  const constraints: string[] = [];
  if (typeof schema.format === "string") constraints.push(schema.format);
  if (typeof schema.pattern === "string") {
    constraints.push(`pattern ${schema.pattern}`);
  }
  if (Array.isArray(schema.enum)) {
    constraints.push(
      `one of ${schema.enum.map((entry) => String(entry)).join(", ")}`
    );
  }
  if (typeof schema.minLength === "number") {
    constraints.push(`minimum length ${schema.minLength}`);
  }
  if (typeof schema.maxLength === "number") {
    constraints.push(`maximum length ${schema.maxLength}`);
  }
  if (typeof schema.minimum === "number") {
    constraints.push(`minimum ${schema.minimum}`);
  }
  if (typeof schema.maximum === "number") {
    constraints.push(`maximum ${schema.maximum}`);
  }
  if (typeof schema.minItems === "number") {
    constraints.push(`minimum ${schema.minItems} items`);
  }
  if (typeof schema.maxItems === "number") {
    constraints.push(`maximum ${schema.maxItems} items`);
  }
  if (schema.default !== undefined) {
    constraints.push(`default ${String(schema.default)}`);
  }
  return constraints;
}

function fieldsFromSchema(
  schemas: Record<string, JsonObject>,
  schemaName: string
): ExternalApiReferenceField[] {
  const schema = schemas[schemaName];
  if (!schema) {
    throw new Error(`Missing external API schema: ${schemaName}`);
  }
  const properties = isObject(schema.properties) ? schema.properties : {};
  const required = new Set(
    Array.isArray(schema.required)
      ? schema.required.filter(
          (entry): entry is string => typeof entry === "string"
        )
      : []
  );

  return Object.entries(properties).map(([name, rawProperty]) => {
    const property = requireObject(
      rawProperty,
      `${schemaName}.${name} property`
    );
    return {
      name,
      type: schemaType(property),
      required: required.has(name),
      description:
        typeof property.description === "string" ? property.description : null,
      constraints: schemaConstraints(property),
    };
  });
}

function parseParameters(value: unknown): ExternalApiReferenceParameter[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new Error("Invalid external API OpenAPI parameters");
  }
  return value.map((rawParameter) => {
    const parameter = requireObject(rawParameter, "parameter");
    const location = requireString(parameter.in, "parameter location");
    if (!["header", "path", "query"].includes(location)) {
      throw new Error("Invalid external API OpenAPI parameter location");
    }
    const schema = requireObject(parameter.schema, "parameter schema");
    return {
      name: requireString(parameter.name, "parameter name"),
      location: location as ExternalApiReferenceParameter["location"],
      type: schemaType(schema),
      required: parameter.required === true,
      description:
        typeof parameter.description === "string"
          ? parameter.description
          : null,
      constraints: schemaConstraints(schema),
    };
  });
}

function parseRequest(
  value: unknown,
  schemas: Record<string, JsonObject>
): ExternalApiReferenceBody | null {
  if (value === undefined) return null;
  const request = requireObject(value, "request body");
  const content = requireObject(request.content, "request body content");
  const media = requireObject(
    content["application/json"],
    "request JSON content"
  );
  const schemaName = referenceName(media.schema, "request schema");
  return {
    required: request.required === true,
    schemaName,
    fields: fieldsFromSchema(schemas, schemaName),
    example: media.example,
  };
}

function parseSuccessResponses(
  value: unknown,
  schemas: Record<string, JsonObject>
): ExternalApiReferenceResponse[] {
  const responses = requireObject(value, "responses");
  return Object.entries(responses)
    .filter(([status]) => /^2\d\d$/.test(status))
    .map(([status, rawResponse]) => {
      const response = requireObject(rawResponse, `${status} response`);
      const content = requireObject(response.content, `${status} content`);
      const media = requireObject(
        content["application/json"],
        `${status} JSON content`
      );
      const schemaName = referenceName(media.schema, `${status} schema`);
      return {
        status,
        description: requireString(
          response.description,
          `${status} description`
        ),
        schemaName,
        fields: fieldsFromSchema(schemas, schemaName),
        example: media.example,
      };
    });
}

function parseErrorStatuses(value: unknown): string[] {
  const responses = requireObject(value, "responses");
  return Object.keys(responses).filter((status) => /^[45]\d\d$/.test(status));
}

function findOperation(
  document: ExternalApiOpenApiDocument,
  operationId: ExternalApiReferenceOperationId
): ExternalApiReferenceOperation {
  for (const [path, pathItem] of Object.entries(document.paths)) {
    for (const method of ["get", "post"] as const) {
      const rawOperation = pathItem[method];
      if (!isObject(rawOperation) || rawOperation.operationId !== operationId) {
        continue;
      }
      const scopes = rawOperation["x-ops-required-scopes"];
      if (
        !Array.isArray(scopes) ||
        !scopes.every((scope): scope is string => typeof scope === "string")
      ) {
        throw new Error(
          `Invalid external API OpenAPI scopes for ${operationId}`
        );
      }
      return {
        operationId,
        method,
        path,
        summary: requireString(rawOperation.summary, `${operationId} summary`),
        description: requireString(
          rawOperation.description,
          `${operationId} description`
        ),
        requiredScopes: scopes,
        parameters: parseParameters(rawOperation.parameters),
        request: parseRequest(
          rawOperation.requestBody,
          document.components.schemas
        ),
        successResponses: parseSuccessResponses(
          rawOperation.responses,
          document.components.schemas
        ),
        errorStatuses: parseErrorStatuses(rawOperation.responses),
      };
    }
  }
  throw new Error(`Missing external API operation: ${operationId}`);
}

function parseDocument(value: unknown): ExternalApiOpenApiDocument {
  const document = requireObject(value, "document");
  if (document.openapi !== "3.1.0") {
    throw new Error("Invalid external API OpenAPI version");
  }
  const info = requireObject(document.info, "info");
  const servers = document.servers;
  if (!Array.isArray(servers) || !isObject(servers[0])) {
    throw new Error("Invalid external API OpenAPI servers");
  }
  const paths = requireObject(document.paths, "paths");
  const components = requireObject(document.components, "components");
  const schemas = requireObject(components.schemas, "schemas");
  return {
    ...document,
    openapi: document.openapi,
    info,
    servers,
    paths: paths as ExternalApiOpenApiDocument["paths"],
    components: {
      ...components,
      schemas: schemas as Record<string, JsonObject>,
    },
  };
}

export function buildExternalApiReference(
  value: unknown
): ExternalApiReference {
  const document = parseDocument(value);
  const server = requireObject(document.servers[0], "server");
  return {
    document,
    openApiVersion: document.openapi,
    apiVersion: requireString(document.info.version, "info version"),
    title: requireString(document.info.title, "info title"),
    description: requireString(document.info.description, "info description"),
    baseUrl: requireString(server.url, "server URL"),
    operations: EXTERNAL_API_REFERENCE_OPERATION_IDS.map((operationId) =>
      findOperation(document, operationId)
    ),
  };
}

export const externalApiReference =
  buildExternalApiReference(externalApiDocument);
