"use client";

import { useState } from "react";
import { Download, Trash2, Database, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ops/confirm-dialog";
import { toast } from "sonner";

export function DataPrivacyTab() {
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false);

  function handleExportData() {
    toast.info("Data export requested", {
      description: "You will receive an email with your data export within 24 hours.",
    });
  }

  function handleDeleteAccount() {
    toast.info("Account deletion requested", {
      description: "Please contact support@opsapp.co to complete this process.",
    });
    setDeleteAccountOpen(false);
  }

  return (
    <div className="space-y-3 max-w-[600px]">
      <Card>
        <CardHeader>
          <CardTitle>Export Your Data</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          <p className="font-mohave text-body-sm text-text-secondary">
            Download a copy of all your data including projects, clients, tasks, and team information.
          </p>
          <Button variant="secondary" className="gap-[6px]" onClick={handleExportData}>
            <Download className="w-[16px] h-[16px]" />
            Request Data Export
          </Button>
          <p className="font-kosugi text-[11px] text-text-disabled">
            Export is generated as a ZIP file containing CSV and JSON files.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Data Retention</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 py-[6px]">
              <Database className="w-[16px] h-[16px] text-ops-accent shrink-0" />
              <div>
                <p className="font-mohave text-body-sm text-text-secondary">Active Data</p>
                <p className="font-kosugi text-[11px] text-text-disabled">
                  Retained as long as your account is active
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 py-[6px]">
              <Clock className="w-[16px] h-[16px] text-ops-amber shrink-0" />
              <div>
                <p className="font-mohave text-body-sm text-text-secondary">Deleted Data</p>
                <p className="font-kosugi text-[11px] text-text-disabled">
                  Permanently removed within 30 days of deletion
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 py-[6px]">
              <Trash2 className="w-[16px] h-[16px] text-text-disabled shrink-0" />
              <div>
                <p className="font-mohave text-body-sm text-text-secondary">Closed Accounts</p>
                <p className="font-kosugi text-[11px] text-text-disabled">
                  All data removed within 90 days of account closure
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Delete Account</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          <p className="font-mohave text-body-sm text-text-secondary">
            Permanently delete your account and all associated data. This action cannot be undone.
          </p>
          <Button
            variant="destructive"
            className="gap-[6px]"
            onClick={() => setDeleteAccountOpen(true)}
          >
            <Trash2 className="w-[16px] h-[16px]" />
            Delete Account
          </Button>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={deleteAccountOpen}
        onOpenChange={setDeleteAccountOpen}
        title="Delete your account?"
        description="This will permanently delete your account, all projects, clients, tasks, and team data. This action cannot be undone."
        confirmLabel="Delete Account"
        variant="destructive"
        onConfirm={handleDeleteAccount}
      />
    </div>
  );
}
