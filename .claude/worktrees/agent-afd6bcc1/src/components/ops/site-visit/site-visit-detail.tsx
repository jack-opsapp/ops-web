"use client";

/**
 * OPS Web - Site Visit Detail
 *
 * Side-panel (Sheet) showing full details of a site visit.
 * Staff can view/edit notes, upload photos, and transition status:
 *   scheduled → in_progress → completed
 *   Any state → cancelled
 */

import { useState } from "react";
import {
  Camera,
  FileText,
  Ruler,
  Lock,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  PlayCircle,
  Users,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { cn } from "@/lib/utils/cn";
import { useSiteVisit, useStartSiteVisit, useCompleteSiteVisit, useCancelSiteVisit } from "@/lib/hooks/use-site-visits";
import { useTeamMembers } from "@/lib/hooks";
import { useAuthStore } from "@/lib/store/auth-store";
import { uploadImage } from "@/lib/api/services";

// ─── Status Badge ─────────────────────────────────────────────────────────────

const STATUS_CONFIG = {
  scheduled: { label: "Scheduled", color: "bg-[#417394]/20 text-[#8BB8D4]" },
  in_progress: { label: "In Progress", color: "bg-[#C4A868]/20 text-[#D4B878]" },
  completed: { label: "Completed", color: "bg-[#9DB582]/20 text-[#B5D4A0]" },
  cancelled: { label: "Cancelled", color: "bg-[#444]/20 text-[#9CA3AF]" },
} as const;

// ─── Props ────────────────────────────────────────────────────────────────────

export interface SiteVisitDetailProps {
  siteVisitId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCompleted?: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function SiteVisitDetail({
  siteVisitId,
  open,
  onOpenChange,
  onCompleted,
}: SiteVisitDetailProps) {
  const { currentUser: user } = useAuthStore();
  const { data: visit, isLoading } = useSiteVisit(siteVisitId ?? undefined);
  const { data: teamData } = useTeamMembers();
  const allMembers = teamData?.users ?? [];
  const startVisit = useStartSiteVisit();
  const completeVisit = useCompleteSiteVisit();
  const cancelVisit = useCancelSiteVisit();

  const [notes, setNotes] = useState("");
  const [measurements, setMeasurements] = useState("");
  const [internalNotes, setInternalNotes] = useState("");
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [localPhotos, setLocalPhotos] = useState<string[]>([]);
  const [initialized, setInitialized] = useState(false);

  // Initialize editable fields from loaded visit
  if (visit && !initialized) {
    setNotes(visit.notes ?? "");
    setMeasurements(visit.measurements ?? "");
    setInternalNotes(visit.internalNotes ?? "");
    setLocalPhotos(visit.photos ?? []);
    setInitialized(true);
  }

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !visit) return;

    setUploadingPhoto(true);
    try {
      const url = await uploadImage(file);
      setLocalPhotos((prev) => [...prev, url]);
      toast.success("Photo uploaded");
    } catch {
      toast.error("Failed to upload photo");
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleStart = async () => {
    if (!siteVisitId) return;
    try {
      await startVisit.mutateAsync(siteVisitId);
      toast.success("Site visit started");
    } catch {
      toast.error("Failed to start visit");
    }
  };

  const handleComplete = async () => {
    if (!siteVisitId) return;
    try {
      await completeVisit.mutateAsync({
        id: siteVisitId,
        data: {
          notes: notes || undefined,
          measurements: measurements || undefined,
          photos: localPhotos,
          internalNotes: internalNotes || undefined,
        },
      });
      toast.success("Site visit completed", {
        description: "Ready to create an estimate?",
        action: { label: "Create Estimate", onClick: () => {} },
      });
      onCompleted?.();
      onOpenChange(false);
    } catch {
      toast.error("Failed to complete visit");
    }
  };

  const handleCancel = async () => {
    if (!siteVisitId) return;
    try {
      await cancelVisit.mutateAsync(siteVisitId);
      toast.success("Site visit cancelled");
      onOpenChange(false);
    } catch {
      toast.error("Failed to cancel visit");
    }
  };

  const assigneeNames = (visit?.assigneeIds ?? [])
    .map((id) => allMembers.find((m) => m.id === id))
    .filter(Boolean)
    .map((m) => `${m!.firstName} ${m!.lastName}`)
    .join(", ");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg bg-[#0A0A0A] border-l border-[#2A2A2A] flex flex-col">
        <SheetHeader className="shrink-0">
          <div className="flex items-center justify-between">
            <SheetTitle className="text-[#E5E5E5] font-['Mohave'] text-xl">
              Site Visit
            </SheetTitle>
            {visit && (
              <span className={cn(
                "px-3 py-1 rounded-full text-xs font-medium",
                STATUS_CONFIG[visit.status].color
              )}>
                {STATUS_CONFIG[visit.status].label}
              </span>
            )}
          </div>
          {visit && (
            <div className="flex flex-col gap-1 mt-1">
              <p className="text-sm text-[#9CA3AF] flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" />
                {visit.scheduledAt.toLocaleDateString()} at{" "}
                {visit.scheduledAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                {" · "}
                {visit.durationMinutes} min
              </p>
              {assigneeNames && (
                <p className="text-sm text-[#9CA3AF] flex items-center gap-1.5">
                  <Users className="h-3.5 w-3.5" />
                  {assigneeNames}
                </p>
              )}
            </div>
          )}
        </SheetHeader>

        {isLoading && (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-[#417394]" />
          </div>
        )}

        {visit && !isLoading && (
          <div className="flex-1 overflow-y-auto space-y-5 mt-4 pr-1">

            {/* Photos */}
            <section>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs text-[#9CA3AF] flex items-center gap-1.5">
                  <Camera className="h-3.5 w-3.5" /> Photos
                </h3>
                <label className="cursor-pointer">
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handlePhotoUpload}
                  />
                  <span className="text-xs text-[#417394] hover:text-[#4f8aae] transition-colors flex items-center gap-1">
                    {uploadingPhoto ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      "Add Photo"
                    )}
                  </span>
                </label>
              </div>
              {localPhotos.length > 0 ? (
                <div className="grid grid-cols-3 gap-2">
                  {localPhotos.map((url, i) => (
                    <div key={i} className="aspect-square rounded-lg overflow-hidden bg-[#1A1A1A]">
                      <img
                        src={url}
                        alt={`Photo ${i + 1}`}
                        className="w-full h-full object-cover"
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-[#444] italic text-center py-4">
                  No photos yet — tap &ldquo;Add Photo&rdquo; above
                </p>
              )}
            </section>

            {/* Notes */}
            <section>
              <h3 className="text-xs text-[#9CA3AF] flex items-center gap-1.5 mb-2">
                <FileText className="h-3.5 w-3.5" /> Notes
              </h3>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="What did you observe during the visit?"
                rows={4}
                className="bg-[#111] border-[#333] text-[#E5E5E5] resize-none text-sm"
              />
            </section>

            {/* Measurements */}
            <section>
              <h3 className="text-xs text-[#9CA3AF] flex items-center gap-1.5 mb-2">
                <Ruler className="h-3.5 w-3.5" /> Measurements
              </h3>
              <Textarea
                value={measurements}
                onChange={(e) => setMeasurements(e.target.value)}
                placeholder="Record dimensions, quantities, or scope notes…"
                rows={3}
                className="bg-[#111] border-[#333] text-[#E5E5E5] resize-none text-sm font-mono"
              />
            </section>

            {/* Internal Notes */}
            <section>
              <h3 className="text-xs text-[#9CA3AF] flex items-center gap-1.5 mb-2">
                <Lock className="h-3.5 w-3.5" /> Internal Notes
                <span className="text-[#444]">(staff only)</span>
              </h3>
              <Textarea
                value={internalNotes}
                onChange={(e) => setInternalNotes(e.target.value)}
                placeholder="Not visible to clients…"
                rows={3}
                className="bg-[#111] border-[#2A4A3A] text-[#E5E5E5] resize-none text-sm"
              />
            </section>
          </div>
        )}

        {/* Action Buttons */}
        {visit && !isLoading && (
          <div className="shrink-0 pt-4 border-t border-[#2A2A2A] space-y-2 mt-2">
            {visit.status === "scheduled" && (
              <Button
                onClick={handleStart}
                disabled={startVisit.isPending}
                className="w-full bg-[#C4A868] hover:bg-[#d4b878] text-black font-medium"
              >
                {startVisit.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <><PlayCircle className="h-4 w-4 mr-2" /> Start Visit</>
                )}
              </Button>
            )}
            {visit.status === "in_progress" && (
              <Button
                onClick={handleComplete}
                disabled={completeVisit.isPending}
                className="w-full bg-[#9DB582] hover:bg-[#adc592] text-black font-medium"
              >
                {completeVisit.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <><CheckCircle2 className="h-4 w-4 mr-2" /> Complete Visit</>
                )}
              </Button>
            )}
            {(visit.status === "scheduled" || visit.status === "in_progress") && (
              <Button
                variant="ghost"
                onClick={handleCancel}
                disabled={cancelVisit.isPending}
                className="w-full text-[#9CA3AF] hover:text-[#93321A]"
              >
                {cancelVisit.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <><XCircle className="h-4 w-4 mr-2" /> Cancel Visit</>
                )}
              </Button>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
