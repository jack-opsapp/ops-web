"use client";

import { Map } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { usePreferencesStore } from "@/stores/preferences-store";
import { toast } from "sonner";
import { useDictionary } from "@/i18n/client";

export function MapPreferencesTab() {
  const { t } = useDictionary("settings");

  const mapDefaultZoom = usePreferencesStore((s) => s.mapDefaultZoom);
  const setMapDefaultZoom = usePreferencesStore((s) => s.setMapDefaultZoom);
  const mapShowTraffic = usePreferencesStore((s) => s.mapShowTraffic);
  const setMapShowTraffic = usePreferencesStore((s) => s.setMapShowTraffic);
  const mapShowCrewLabels = usePreferencesStore((s) => s.mapShowCrewLabels);
  const setMapShowCrewLabels = usePreferencesStore((s) => s.setMapShowCrewLabels);

  return (
    <div className="space-y-3 max-w-[600px]">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Map className="w-[16px] h-[16px] text-text-secondary" />
            <CardTitle>{t("map.title")}</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Zoom Level Slider */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <p className="font-mohave text-body text-text-primary">{t("map.defaultZoom")}</p>
              <span className="font-kosugi text-[11px] text-text-tertiary">{mapDefaultZoom}x</span>
            </div>
            <input
              type="range"
              min={8}
              max={18}
              step={1}
              value={mapDefaultZoom}
              onChange={(e) => {
                const zoom = parseInt(e.target.value, 10);
                setMapDefaultZoom(zoom);
              }}
              onMouseUp={() => toast.success(`${t("map.toast.zoomSet")} ${mapDefaultZoom}x`)}
              onTouchEnd={() => toast.success(`${t("map.toast.zoomSet")} ${mapDefaultZoom}x`)}
              className="w-full accent-ops-accent"
            />
            <div className="flex justify-between font-kosugi text-[10px] text-text-disabled">
              <span>{t("map.zoomOut")}</span>
              <span>{t("map.zoomIn")}</span>
            </div>
          </div>

          {/* Traffic Toggle */}
          <div className="flex items-center justify-between py-[6px]">
            <div>
              <p className="font-mohave text-body text-text-primary">{t("map.showTraffic")}</p>
              <p className="font-kosugi text-[11px] text-text-disabled">{t("map.showTrafficDesc")}</p>
            </div>
            <button
              onClick={() => {
                const newValue = !mapShowTraffic;
                setMapShowTraffic(newValue);
                toast.success(newValue ? t("map.toast.trafficEnabled") : t("map.toast.trafficDisabled"));
              }}
              className={cn(
                "w-[40px] h-[22px] rounded-full transition-colors relative shrink-0",
                mapShowTraffic ? "bg-ops-accent" : "bg-background-elevated"
              )}
            >
              <span
                className={cn(
                  "absolute top-[2px] w-[18px] h-[18px] rounded-full bg-white transition-all",
                  mapShowTraffic ? "right-[2px]" : "left-[2px]"
                )}
              />
            </button>
          </div>

          {/* Crew Labels Toggle */}
          <div className="flex items-center justify-between py-[6px]">
            <div>
              <p className="font-mohave text-body text-text-primary">{t("map.showCrewLabels")}</p>
              <p className="font-kosugi text-[11px] text-text-disabled">{t("map.showCrewLabelsDesc")}</p>
            </div>
            <button
              onClick={() => {
                const newValue = !mapShowCrewLabels;
                setMapShowCrewLabels(newValue);
                toast.success(newValue ? t("map.toast.labelsEnabled") : t("map.toast.labelsDisabled"));
              }}
              className={cn(
                "w-[40px] h-[22px] rounded-full transition-colors relative shrink-0",
                mapShowCrewLabels ? "bg-ops-accent" : "bg-background-elevated"
              )}
            >
              <span
                className={cn(
                  "absolute top-[2px] w-[18px] h-[18px] rounded-full bg-white transition-all",
                  mapShowCrewLabels ? "right-[2px]" : "left-[2px]"
                )}
              />
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
