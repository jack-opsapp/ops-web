"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { motion, useReducedMotion, type Variants } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { EASE_SMOOTH } from "@/lib/utils/motion";
import { useCompany } from "@/lib/hooks";
import { OpsLockup } from "@/components/brand";

function WelcomeContent() {
  const searchParams = useSearchParams();
  // companyIdParam is reserved for future multi-company routing — currently
  // the logged-in company drives the display.
  void searchParams.get("company");
  const { data: company } = useCompany();
  const reduce = useReducedMotion();

  const companyName = company?.name ?? "your team";
  const companyLogo = company?.logoURL ?? null;

  const iosAppId = process.env.NEXT_PUBLIC_OPS_IOS_APP_ID;
  const appStoreUrl = iosAppId
    ? `https://apps.apple.com/app/id${iosAppId}`
    : "https://apps.apple.com/app/ops";

  const blockVariants: Variants = reduce
    ? {
        hidden: { opacity: 0 },
        visible: { opacity: 1, transition: { duration: 0.15, ease: EASE_SMOOTH } },
      }
    : {
        hidden: { opacity: 0, y: 8 },
        visible: (i: number) => ({
          opacity: 1,
          y: 0,
          transition: { duration: 0.3, delay: i * 0.06, ease: EASE_SMOOTH },
        }),
      };

  const [pulseOn, setPulseOn] = useState(false);
  useEffect(() => {
    if (reduce) return;
    const id = window.setTimeout(() => setPulseOn(true), 450);
    return () => window.clearTimeout(id);
  }, [reduce]);

  return (
    <main className="min-h-screen bg-background flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-[420px] flex flex-col gap-6">
        <div className="flex justify-center text-text">
          <OpsLockup orientation="horizontal" className="h-7 w-auto" />
        </div>

        {companyLogo && (
          <div className="flex justify-center">
            <Image
              src={companyLogo}
              alt={`${companyName} logo`}
              width={64}
              height={64}
              className="w-16 h-16 rounded-sm object-contain border border-border-subtle"
              unoptimized
            />
          </div>
        )}

        <motion.div
          custom={0}
          initial="hidden"
          animate="visible"
          variants={blockVariants}
          className="text-left"
        >
          <h1 className="font-cakemono text-display font-light uppercase text-text tracking-tight leading-none">
            You&apos;re in.
          </h1>
          <p className="font-mohave text-body-lg text-text-2 mt-2">
            Welcome to {companyName}.
          </p>
        </motion.div>

        <motion.p
          custom={1}
          initial="hidden"
          animate="visible"
          variants={blockVariants}
          className="font-mohave text-body-sm text-text-2 leading-relaxed"
        >
          OPS runs on iOS. Get the app now, or finish setting up in your browser.
        </motion.p>

        <motion.div
          custom={2}
          initial="hidden"
          animate="visible"
          variants={blockVariants}
          className="flex flex-col gap-3"
        >
          <motion.a
            href={appStoreUrl}
            target="_blank"
            rel="noopener"
            className="bg-ops-accent hover:bg-ops-accent-hover text-text font-kosugi text-button uppercase tracking-wider rounded-sm px-6 py-3 w-full inline-flex items-center justify-center gap-2 transition-colors"
            animate={pulseOn ? { opacity: [0.6, 1] } : undefined}
            transition={{ duration: 0.4, ease: EASE_SMOOTH }}
          >
            Download for iOS
            <ArrowRight className="w-[16px] h-[16px]" />
          </motion.a>
          <Link
            href="/employee-setup?fromInvite=1"
            className="font-kosugi text-micro uppercase tracking-wider text-text-3 hover:text-text-2 transition-colors text-center inline-flex items-center justify-center gap-1"
          >
            Continue on web
            <ArrowRight className="w-[12px] h-[12px]" />
          </Link>
        </motion.div>
      </div>
    </main>
  );
}

export default function JoinWelcomePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <WelcomeContent />
    </Suspense>
  );
}
