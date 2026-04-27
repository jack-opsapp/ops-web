"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import enDict from "@/i18n/dictionaries/en/unsubscribe.json";
import esDict from "@/i18n/dictionaries/es/unsubscribe.json";
import { LIST_DISPLAY_NAMES, OPS_SUPPORT_EMAIL } from "@/lib/email/constants";

const EASE_SMOOTH: [number, number, number, number] = [0.22, 1, 0.36, 1];

type ErrorReason = keyof typeof enDict.errors;

type State =
  | { kind: "loading" }
  | { kind: "success"; list: string }
  | { kind: "error"; reason: ErrorReason };

/**
 * Detect locale from `navigator.language`. The `/unsubscribe` route is
 * outside the authenticated app shell so it does not have access to the
 * `LanguageProvider` cookie context. Browser language is the only reliable
 * signal for an opted-out recipient who may not even have an OPS account.
 */
function detectLocale(): "en" | "es" {
  if (typeof navigator === "undefined") return "en";
  const tag = navigator.language ?? "en";
  return tag.toLowerCase().startsWith("es") ? "es" : "en";
}

function UnsubscribeInner() {
  const params = useSearchParams();
  const [locale, setLocale] = React.useState<"en" | "es">("en");
  const dict = locale === "es" ? esDict : enDict;
  const reduced = useReducedMotion();
  const [state, setState] = React.useState<State>({ kind: "loading" });
  const token = params.get("t");

  React.useEffect(() => {
    setLocale(detectLocale());
  }, []);

  React.useEffect(() => {
    if (!token) {
      setState({ kind: "error", reason: "missing_token" });
      return;
    }
    let cancelled = false;
    fetch("/api/email/unsubscribe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then((r) => r.json())
      .then((body) => {
        if (cancelled) return;
        if (body.ok) {
          setState({ kind: "success", list: body.list ?? "global" });
        } else {
          const reason = (body.reason ?? "internal") as ErrorReason;
          setState({
            kind: "error",
            reason: reason in enDict.errors ? reason : "internal",
          });
        }
      })
      .catch(() => {
        if (cancelled) return;
        setState({ kind: "error", reason: "internal" });
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <main className="min-h-screen bg-black text-[#EDEDED] flex items-center justify-center px-4 py-12">
      <motion.section
        initial={{ opacity: 0, y: reduced ? 0 : 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: reduced ? 0 : 0.32, ease: EASE_SMOOTH }}
        className="w-full max-w-[480px]"
      >
        <header className="mb-8 flex items-center justify-between">
          <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#8A8A8A]">
            {"// OPS LTD."}
          </div>
          <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#6A6A6A]">
            [{dict.eyebrow}]
          </div>
        </header>
        <article
          className="border border-white/[0.09] backdrop-blur-[28px] backdrop-saturate-[1.3] px-8 py-10"
          style={{ background: "rgba(18, 18, 20, 0.58)", borderRadius: 12 }}
        >
          {state.kind === "loading" && (
            <div>
              <h1 className="font-cakemono font-light text-[26px] leading-[1.1] uppercase text-[#EDEDED]">
                {dict.loading.title}
              </h1>
              <p className="mt-3 font-mohave text-[15px] leading-[1.55] text-[#B5B5B5]">
                {dict.loading.body}
              </p>
            </div>
          )}

          {state.kind === "success" && (
            <div>
              <h1 className="font-cakemono font-light text-[26px] leading-[1.1] uppercase text-[#EDEDED]">
                {dict.success.title}
              </h1>
              <p className="mt-3 font-mohave text-[15px] leading-[1.55] text-[#B5B5B5]">
                {dict.success.body.replace(
                  "[{list}]",
                  LIST_DISPLAY_NAMES[state.list] ?? state.list,
                )}
              </p>
              <Link
                href="https://opsapp.co"
                className="mt-8 inline-flex items-center justify-center px-6 py-3 border border-[#6F94B0] text-[#6F94B0] font-mono text-[11px] uppercase tracking-[0.18em] transition-colors hover:bg-[#6F94B0] hover:text-black"
                style={{ borderRadius: 5 }}
              >
                {dict.success.cta}
              </Link>
            </div>
          )}

          {state.kind === "error" && (
            <div>
              <h1 className="font-cakemono font-light text-[26px] leading-[1.1] uppercase text-[#EDEDED]">
                {dict.errors[state.reason].title}
              </h1>
              <p className="mt-3 font-mohave text-[15px] leading-[1.55] text-[#B5B5B5]">
                {dict.errors[state.reason].body.replace("[{email}]", OPS_SUPPORT_EMAIL)}
              </p>
              <a
                href={`mailto:${OPS_SUPPORT_EMAIL}?subject=Unsubscribe me`}
                className="mt-8 inline-flex items-center justify-center px-6 py-3 border border-[#6F94B0] text-[#6F94B0] font-mono text-[11px] uppercase tracking-[0.18em] transition-colors hover:bg-[#6F94B0] hover:text-black"
                style={{ borderRadius: 5 }}
              >
                {dict.errors[state.reason].cta}
              </a>
            </div>
          )}
        </article>
      </motion.section>
    </main>
  );
}

export default function UnsubscribePage() {
  return (
    <React.Suspense fallback={null}>
      <UnsubscribeInner />
    </React.Suspense>
  );
}
