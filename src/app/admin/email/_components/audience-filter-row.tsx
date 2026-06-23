"use client";

import * as React from "react";
import type {
  AudienceFilterClause,
  AudienceField,
  AudienceOp,
} from "@/lib/admin/types";
import { FIELD_OPTIONS, OP_OPTIONS } from "./audience-filter-config";

interface Props {
  clause: AudienceFilterClause;
  onChange: (next: AudienceFilterClause) => void;
  onRemove: () => void;
}

export function AudienceFilterRow({ clause, onChange, onRemove }: Props) {
  const fieldMeta =
    FIELD_OPTIONS.find((f) => f.id === clause.field) ?? FIELD_OPTIONS[0];
  const ops = OP_OPTIONS[fieldMeta.type] ?? OP_OPTIONS.text;
  const opMeta = ops.find((o) => o.id === clause.op) ?? ops[0];

  return (
    <div className="flex items-center gap-2 flex-wrap font-mohave text-[13px]">
      <select
        value={clause.field}
        onChange={(e) => {
          const nextField = e.target.value as AudienceField;
          const nextMeta =
            FIELD_OPTIONS.find((f) => f.id === nextField) ?? FIELD_OPTIONS[0];
          const nextOps = OP_OPTIONS[nextMeta.type] ?? OP_OPTIONS.text;
          onChange({ field: nextField, op: nextOps[0].id, value: undefined });
        }}
        className="bg-transparent border border-white/10 rounded-chip px-2 py-1 text-[#EDEDED]"
      >
        {FIELD_OPTIONS.map((f) => (
          <option key={f.id} value={f.id} className="bg-black">
            {f.label}
          </option>
        ))}
      </select>
      <select
        value={clause.op}
        onChange={(e) => onChange({ ...clause, op: e.target.value as AudienceOp })}
        className="bg-transparent border border-white/10 rounded-chip px-2 py-1 text-[#EDEDED]"
      >
        {ops.map((o) => (
          <option key={o.id} value={o.id} className="bg-black">
            {o.label}
          </option>
        ))}
      </select>
      {opMeta.needsValue && (
        <ValueInput
          fieldType={fieldMeta.type}
          arrayValue={!!opMeta.arrayValue}
          enumValues={fieldMeta.values}
          value={clause.value}
          onChange={(v) => onChange({ ...clause, value: v })}
        />
      )}
      <button
        onClick={onRemove}
        className="font-cakemono font-light text-[10px] tracking-[0.06em] text-[#8A8A8A] hover:text-[#B58289] px-2 py-1"
      >
        REMOVE
      </button>
    </div>
  );
}

interface ValueInputProps {
  fieldType: string;
  arrayValue: boolean;
  enumValues?: string[];
  value: unknown;
  onChange: (v: unknown) => void;
}

function ValueInput({
  fieldType,
  arrayValue,
  enumValues,
  value,
  onChange,
}: ValueInputProps) {
  if (fieldType === "boolean") {
    return (
      <select
        value={String(value ?? "true")}
        onChange={(e) => onChange(e.target.value === "true")}
        className="bg-transparent border border-white/10 rounded-chip px-2 py-1 text-[#EDEDED]"
      >
        <option value="true" className="bg-black">true</option>
        <option value="false" className="bg-black">false</option>
      </select>
    );
  }
  if (fieldType === "enum" && enumValues) {
    if (arrayValue) {
      const arr = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div className="flex gap-1 flex-wrap">
          {enumValues.map((v) => {
            const on = arr.includes(v);
            return (
              <button
                key={v}
                onClick={() =>
                  onChange(
                    on ? arr.filter((x) => x !== v) : [...arr, v]
                  )
                }
                className="px-2 py-0.5 rounded-chip font-mono text-[11px]"
                style={{
                  border: `1px solid ${
                    on ? "#6F94B0" : "rgba(255,255,255,0.12)"
                  }`,
                  color: on ? "#6F94B0" : "#B5B5B5",
                }}
              >
                {v}
              </button>
            );
          })}
        </div>
      );
    }
    return (
      <select
        value={String(value ?? enumValues[0])}
        onChange={(e) => onChange(e.target.value)}
        className="bg-transparent border border-white/10 rounded-chip px-2 py-1 text-[#EDEDED]"
      >
        {enumValues.map((v) => (
          <option key={v} value={v} className="bg-black">
            {v}
          </option>
        ))}
      </select>
    );
  }
  if (fieldType === "date") {
    return (
      <input
        type="date"
        value={String(value ?? "")}
        onChange={(e) => onChange(e.target.value)}
        className="bg-transparent border border-white/10 rounded-chip px-2 py-1 font-mono text-[12px] text-[#EDEDED]"
      />
    );
  }
  return (
    <input
      value={
        Array.isArray(value)
          ? (value as string[]).join(",")
          : String(value ?? "")
      }
      onChange={(e) =>
        onChange(
          arrayValue
            ? e.target.value
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean)
            : e.target.value
        )
      }
      placeholder={arrayValue ? "comma,separated,list" : ""}
      className="bg-transparent border border-white/10 rounded-chip px-2 py-1 font-mono text-[12px] text-[#EDEDED]"
    />
  );
}
