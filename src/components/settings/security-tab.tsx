"use client";

import { useState } from "react";
import { Shield, Smartphone, Monitor } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

export function SecurityTab() {
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");

  function handleChangePin() {
    if (newPin.length !== 4) {
      toast.error("PIN must be 4 digits");
      return;
    }
    if (newPin !== confirmPin) {
      toast.error("PINs do not match");
      return;
    }
    toast.success("PIN updated successfully");
    setCurrentPin("");
    setNewPin("");
    setConfirmPin("");
  }

  return (
    <div className="space-y-3 max-w-[600px]">
      <Card>
        <CardHeader>
          <CardTitle>Change PIN</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Input
            label="Current PIN"
            type="password"
            maxLength={4}
            value={currentPin}
            onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, ""))}
            placeholder="Enter current 4-digit PIN"
          />
          <Input
            label="New PIN"
            type="password"
            maxLength={4}
            value={newPin}
            onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ""))}
            placeholder="Enter new 4-digit PIN"
          />
          <Input
            label="Confirm New PIN"
            type="password"
            maxLength={4}
            value={confirmPin}
            onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ""))}
            placeholder="Re-enter new PIN"
          />
          <div className="pt-1">
            <Button onClick={handleChangePin} className="gap-[6px]" disabled={!currentPin || !newPin || !confirmPin}>
              <Shield className="w-[16px] h-[16px]" />
              Update PIN
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Two-Factor Authentication</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-1.5 py-2">
            <Smartphone className="w-[24px] h-[24px] text-text-disabled" />
            <div>
              <p className="font-mohave text-body text-text-secondary">Coming Soon</p>
              <p className="font-kosugi text-[11px] text-text-disabled">
                Add an extra layer of security with authenticator app or SMS verification.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Active Sessions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between py-[6px] border-b border-[rgba(255,255,255,0.04)]">
              <div className="flex items-center gap-1.5">
                <Monitor className="w-[16px] h-[16px] text-ops-accent" />
                <div>
                  <p className="font-mohave text-body-sm text-text-primary">Current Session</p>
                  <p className="font-kosugi text-[10px] text-text-disabled">Web Browser</p>
                </div>
              </div>
              <span className="font-kosugi text-[10px] text-status-success uppercase tracking-wider">Active</span>
            </div>
          </div>
          <p className="font-kosugi text-[11px] text-text-disabled mt-1.5">
            Session management for mobile devices coming soon.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
