import { z } from "zod-v4";

export const CONTRACT_VERSION = "2026-08-07.v1" as const;

export const ContractVersionSchema = z.literal(CONTRACT_VERSION);

export type ContractVersion = z.infer<typeof ContractVersionSchema>;
