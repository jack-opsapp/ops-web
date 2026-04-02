"use client";

import { useState, useMemo } from "react";
import type { EditorOption } from "./option-manager";

export interface EditorVariant {
  id?: string;
  sku: string;
  priceCents: number;
  stockQuantity: number;
  reservedQuantity: number;
  isActive: boolean;
  optionValues: Record<string, string>;
}

interface VariantMatrixProps {
  options: EditorOption[];
  variants: EditorVariant[];
  productSlug: string;
  basePriceCents: number;
  onChange: (variants: EditorVariant[]) => void;
}

export function VariantMatrix({
  options,
  variants,
  productSlug,
  basePriceCents,
  onChange,
}: VariantMatrixProps) {
  // Generate all combinations from options
  const combinations = useMemo(() => {
    if (options.length === 0 || options.some((o) => o.values.length === 0)) return [];

    function cartesian(arrays: string[][]): string[][] {
      return arrays.reduce<string[][]>(
        (acc, curr) => acc.flatMap((a) => curr.map((c) => [...a, c])),
        [[]]
      );
    }

    const valueArrays = options.map((o) => o.values.map((v) => v.value));
    return cartesian(valueArrays).map((combo) => {
      const optionValues: Record<string, string> = {};
      options.forEach((o, i) => { optionValues[o.name] = combo[i]; });
      return optionValues;
    });
  }, [options]);

  // Match existing variants to combinations, create missing ones
  const mergedVariants = useMemo(() => {
    return combinations.map((combo) => {
      const key = Object.values(combo).join("-").toLowerCase();
      const existing = variants.find((v) => {
        const vKey = Object.values(v.optionValues).join("-").toLowerCase();
        return vKey === key;
      });

      if (existing) return existing;

      return {
        sku: `${productSlug}-${key}`.replace(/\s+/g, "-"),
        priceCents: basePriceCents,
        stockQuantity: 0,
        reservedQuantity: 0,
        isActive: true,
        optionValues: combo,
      };
    });
  }, [combinations, variants, productSlug, basePriceCents]);

  function updateVariant(index: number, field: keyof EditorVariant, value: unknown) {
    const updated = [...mergedVariants];
    updated[index] = { ...updated[index], [field]: value };
    onChange(updated);
  }

  function setAllPrices(priceCents: number) {
    onChange(mergedVariants.map((v) => ({ ...v, priceCents })));
  }

  function setAllStock(stockQuantity: number) {
    onChange(mergedVariants.map((v) => ({ ...v, stockQuantity })));
  }

  if (mergedVariants.length === 0) {
    return (
      <div>
        <p className="font-kosugi text-[11px] uppercase tracking-widest text-[#6B6B6B] mb-3">
          Variants
        </p>
        <p className="font-mohave text-[13px] text-[#6B6B6B]">
          Add options above to generate variants.
        </p>
      </div>
    );
  }

  const optionNames = options.map((o) => o.name);

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="font-kosugi text-[11px] uppercase tracking-widest text-[#6B6B6B]">
          Variants ({mergedVariants.length})
        </p>
        <div className="flex items-center gap-2">
          <BulkSetButton label="Set all prices" onSet={(v) => setAllPrices(Math.round(v * 100))} />
          <BulkSetButton label="Set all stock" onSet={(v) => setAllStock(v)} isInteger />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-white/[0.08]">
              {optionNames.map((name) => (
                <th
                  key={name}
                  className="px-3 py-2 text-left font-kosugi text-[11px] uppercase tracking-widest text-[#6B6B6B]"
                >
                  {name}
                </th>
              ))}
              <th className="px-3 py-2 text-left font-kosugi text-[11px] uppercase tracking-widest text-[#6B6B6B]">
                SKU
              </th>
              <th className="px-3 py-2 text-left font-kosugi text-[11px] uppercase tracking-widest text-[#6B6B6B] w-[100px]">
                Price
              </th>
              <th className="px-3 py-2 text-left font-kosugi text-[11px] uppercase tracking-widest text-[#6B6B6B] w-[80px]">
                Stock
              </th>
              <th className="px-3 py-2 text-left font-kosugi text-[11px] uppercase tracking-widest text-[#6B6B6B] w-[70px]">
                Reserved
              </th>
              <th className="px-3 py-2 text-left font-kosugi text-[11px] uppercase tracking-widest text-[#6B6B6B] w-[80px]">
                Available
              </th>
              <th className="px-3 py-2 text-left font-kosugi text-[11px] uppercase tracking-widest text-[#6B6B6B] w-[60px]">
                Active
              </th>
            </tr>
          </thead>
          <tbody>
            {mergedVariants.map((v, i) => {
              const available = v.stockQuantity - v.reservedQuantity;
              const stockColor =
                available > 10 ? "text-emerald-400" : available > 3 ? "text-amber-400" : "text-red-400";

              return (
                <tr key={i} className="border-b border-white/[0.06] hover:bg-white/[0.02]">
                  {optionNames.map((name) => (
                    <td key={name} className="px-3 py-2 font-mohave text-[13px] text-[#E5E5E5]">
                      {v.optionValues[name]}
                    </td>
                  ))}
                  <td className="px-3 py-2">
                    <input
                      type="text"
                      value={v.sku}
                      onChange={(e) => updateVariant(i, "sku", e.target.value)}
                      className="w-full bg-transparent border-b border-white/[0.06] font-mohave text-[12px] text-[#E5E5E5] focus:border-[#597794] focus:outline-none py-1"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center">
                      <span className="font-mohave text-[12px] text-[#6B6B6B] mr-1">$</span>
                      <input
                        type="number"
                        step="0.01"
                        value={(v.priceCents / 100).toFixed(2)}
                        onChange={(e) => updateVariant(i, "priceCents", Math.round(parseFloat(e.target.value || "0") * 100))}
                        className="w-16 bg-transparent border-b border-white/[0.06] font-mohave text-[12px] text-[#E5E5E5] focus:border-[#597794] focus:outline-none py-1 text-right"
                      />
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      value={v.stockQuantity}
                      onChange={(e) => updateVariant(i, "stockQuantity", parseInt(e.target.value || "0"))}
                      className="w-14 bg-transparent border-b border-white/[0.06] font-mohave text-[12px] text-[#E5E5E5] focus:border-[#597794] focus:outline-none py-1 text-right"
                    />
                  </td>
                  <td className="px-3 py-2 font-mohave text-[12px] text-[#6B6B6B] text-right">
                    {v.reservedQuantity}
                  </td>
                  <td className={`px-3 py-2 font-mohave text-[12px] text-right ${stockColor}`}>
                    {available}
                  </td>
                  <td className="px-3 py-2">
                    <button
                      onClick={() => updateVariant(i, "isActive", !v.isActive)}
                      className={`w-8 h-4 rounded-full transition-colors relative ${
                        v.isActive ? "bg-[#597794]" : "bg-white/[0.08]"
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${
                          v.isActive ? "left-[18px]" : "left-0.5"
                        }`}
                      />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BulkSetButton({
  label,
  onSet,
  isInteger,
}: {
  label: string;
  onSet: (value: number) => void;
  isInteger?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");

  return open ? (
    <div className="flex items-center gap-1">
      <input
        type="number"
        step={isInteger ? "1" : "0.01"}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && value) {
            onSet(isInteger ? parseInt(value) : parseFloat(value));
            setOpen(false);
            setValue("");
          }
        }}
        autoFocus
        className="w-20 bg-white/[0.04] border border-white/[0.08] rounded-sm px-2 py-1 font-mohave text-[11px] text-[#E5E5E5] focus:border-[#597794] focus:outline-none"
      />
      <button
        onClick={() => {
          if (value) onSet(isInteger ? parseInt(value) : parseFloat(value));
          setOpen(false);
          setValue("");
        }}
        className="px-2 py-1 bg-[#597794] rounded-sm font-kosugi text-[9px] uppercase text-white"
      >
        Set
      </button>
    </div>
  ) : (
    <button
      onClick={() => setOpen(true)}
      className="font-kosugi text-[10px] uppercase tracking-widest text-[#6B6B6B] hover:text-[#E5E5E5] transition-colors"
    >
      {label}
    </button>
  );
}
