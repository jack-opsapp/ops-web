"use client";

import { useRouter } from "next/navigation";
import { MapPin, ExternalLink } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge, type ProjectStatus as StatusBadgeProjectStatus } from "@/components/ops/status-badge";
import { InfoRow } from "@/components/ops/info-row";
import { UserAvatar } from "@/components/ops/user-avatar";
import { Button } from "@/components/ui/button";
import { useClient } from "@/lib/hooks/use-clients";
import { type Project, ProjectStatus, getUserFullName } from "@/lib/types/models";

function statusToKey(status: ProjectStatus): StatusBadgeProjectStatus {
  switch (status) {
    case ProjectStatus.RFQ:
      return "rfq";
    case ProjectStatus.Estimated:
      return "estimated";
    case ProjectStatus.Accepted:
      return "accepted";
    case ProjectStatus.InProgress:
      return "in-progress";
    case ProjectStatus.Completed:
      return "completed";
    case ProjectStatus.Closed:
      return "closed";
    case ProjectStatus.Archived:
      return "archived";
    default:
      return "rfq";
  }
}

interface ProjectDetailModalProps {
  project: Project | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ProjectDetailModal({ project, open, onOpenChange }: ProjectDetailModalProps) {
  const router = useRouter();
  const { data: client } = useClient(project?.clientId ?? undefined);
  const resolvedClient = project?.client ?? client;

  if (!project) return null;

  const mapQuery = project.address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(project.address)}`
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[900px]">
        <DialogHeader>
          <div className="flex items-center gap-1.5 flex-wrap">
            <DialogTitle>{project.title}</DialogTitle>
            <StatusBadge status={statusToKey(project.status)} />
          </div>
          <DialogDescription>
            {resolvedClient?.name ?? "No Client"} {project.address ? `\u2022 ${project.address}` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 mt-1">
          {/* Client Info */}
          <Card>
            <CardHeader>
              <CardTitle>Client</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              {resolvedClient ? (
                <>
                  <InfoRow label="Name" value={resolvedClient.name} />
                  {resolvedClient.email && (
                    <InfoRow
                      label="Email"
                      value={
                        <a href={`mailto:${resolvedClient.email}`} className="text-ops-accent hover:underline">
                          {resolvedClient.email}
                        </a>
                      }
                      mono
                    />
                  )}
                  {resolvedClient.phoneNumber && (
                    <InfoRow
                      label="Phone"
                      value={
                        <a href={`tel:${resolvedClient.phoneNumber}`} className="text-text-primary hover:text-ops-accent">
                          {resolvedClient.phoneNumber}
                        </a>
                      }
                      mono
                    />
                  )}
                  {resolvedClient.address && (
                    <InfoRow label="Address" value={resolvedClient.address} />
                  )}
                </>
              ) : (
                <p className="font-mohave text-body-sm text-text-tertiary">No client assigned</p>
              )}
            </CardContent>
          </Card>

          {/* Location */}
          <Card>
            <CardHeader>
              <CardTitle>Location</CardTitle>
            </CardHeader>
            <CardContent>
              {project.address ? (
                <>
                  <div className="flex items-start gap-1">
                    <MapPin className="w-[16px] h-[16px] text-ops-accent shrink-0 mt-[2px]" />
                    <p className="font-mohave text-body text-text-primary">{project.address}</p>
                  </div>
                  {mapQuery && (
                    <a
                      href={mapQuery}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-[6px] mt-1 font-mohave text-body-sm text-ops-accent hover:underline"
                    >
                      <ExternalLink className="w-[14px] h-[14px]" />
                      Open in Google Maps
                    </a>
                  )}
                </>
              ) : (
                <p className="font-mohave text-body-sm text-text-tertiary">No address set</p>
              )}
            </CardContent>
          </Card>

          {/* Team */}
          <Card>
            <CardHeader>
              <CardTitle>Team</CardTitle>
            </CardHeader>
            <CardContent>
              {project.teamMembers && project.teamMembers.length > 0 ? (
                <div className="space-y-1">
                  {project.teamMembers.map((member, i) => (
                    <div key={member.id || i} className="flex items-center gap-1">
                      <UserAvatar
                        name={getUserFullName(member)}
                        imageUrl={member.profileImageURL}
                        size="sm"
                        color={member.userColor ?? undefined}
                      />
                      <div>
                        <p className="font-mohave text-body-sm text-text-primary">
                          {getUserFullName(member)}
                        </p>
                        <span className="font-kosugi text-[10px] text-text-tertiary uppercase tracking-wider">
                          {member.role}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : project.teamMemberIds.length > 0 ? (
                <p className="font-mohave text-body-sm text-text-tertiary">
                  {project.teamMemberIds.length} team member{project.teamMemberIds.length !== 1 ? "s" : ""} assigned
                </p>
              ) : (
                <p className="font-mohave text-body-sm text-text-tertiary">No team members assigned</p>
              )}
            </CardContent>
          </Card>

          {/* Details */}
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              <div className="flex items-center gap-2">
                <div>
                  <span className="font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">Start</span>
                  <p className="font-mono text-data-sm text-text-primary">
                    {project.startDate
                      ? new Date(project.startDate).toLocaleDateString("en-US", {
                          weekday: "short",
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })
                      : "Not set"}
                  </p>
                </div>
                <div className="h-[1px] flex-1 bg-border-subtle" />
                <div>
                  <span className="font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">End</span>
                  <p className="font-mono text-data-sm text-text-primary">
                    {project.endDate
                      ? new Date(project.endDate).toLocaleDateString("en-US", {
                          weekday: "short",
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })
                      : "TBD"}
                  </p>
                </div>
              </div>
              {project.projectDescription && (
                <div>
                  <span className="font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">Description</span>
                  <p className="font-mohave text-body-sm text-text-secondary mt-[4px]">
                    {project.projectDescription}
                  </p>
                </div>
              )}
              {project.notes && (
                <div>
                  <span className="font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">Notes</span>
                  <p className="font-mohave text-body-sm text-text-secondary mt-[4px]">
                    {project.notes}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <DialogFooter>
          <Button
            variant="secondary"
            size="sm"
            className="gap-[6px]"
            onClick={() => {
              onOpenChange(false);
              router.push(`/projects/${project.id}`);
            }}
          >
            <ExternalLink className="w-[14px] h-[14px]" />
            Open Full Page
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
