"use client";

import { Map } from "lucide-react";
import { Switch } from "@/components/ui/switch";
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
    <div className="max-w-3xl space-y-3">
      <div className="glass-surface rounded-panel p-3">
        <div className="flex items-center gap-2 pb-3">
          <Map className="h-[16px] w-[16px] text-text-3" />
          <span className="font-mono text-micro uppercase tracking-[0.16em] text-text-3">
            <span className="text-text-mute">{"// "}</span>
            {t("map.title")}
          </span>
        </div>

        <div className="space-y-3">
          {/* Zoom Level Slider */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <p className="font-mohave text-body text-text">{t("map.defaultZoom")}</p>
              <span className="font-mono text-micro tabular-nums text-text-3">{mapDefaultZoom}x</span>
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
              className="w-full accent-text-2"
            />
            <div className="flex justify-between font-mono text-micro text-text-mute">
              <span>{t("map.zoomOut")}</span>
              <span>{t("map.zoomIn")}</span>
            </div>
          </div>

          {/* Traffic Toggle */}
          <div className="flex items-center justify-between gap-3 border-t border-border py-[6px] pt-3">
            <div>
              <p className="font-mohave text-body text-text">{t("map.showTraffic")}</p>
              <p className="font-mono text-micro text-text-mute">{t("map.showTrafficDesc")}</p>
            </div>
            <Switch
              checked={mapShowTraffic}
              onCheckedChange={(value) => {
                setMapShowTraffic(value);
                toast.success(value ? t("map.toast.trafficEnabled") : t("map.toast.trafficDisabled"));
              }}
            />
          </div>

          {/* Crew Labels Toggle */}
          <div className="flex items-center justify-between gap-3 border-t border-border py-[6px] pt-3">
            <div>
              <p className="font-mohave text-body text-text">{t("map.showCrewLabels")}</p>
              <p className="font-mono text-micro text-text-mute">{t("map.showCrewLabelsDesc")}</p>
            </div>
            <Switch
              checked={mapShowCrewLabels}
              onCheckedChange={(value) => {
                setMapShowCrewLabels(value);
                toast.success(value ? t("map.toast.labelsEnabled") : t("map.toast.labelsDisabled"));
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
