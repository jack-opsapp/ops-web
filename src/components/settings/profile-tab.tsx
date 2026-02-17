"use client";

import { useState, useEffect, useRef } from "react";
import { Camera, Save, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuthStore } from "@/lib/store/auth-store";
import { useCurrentUser, useUpdateUser, useImageUpload } from "@/lib/hooks";
import { getUserFullName } from "@/lib/types/models";
import { toast } from "sonner";

export function ProfileTab() {
  const { currentUser } = useAuthStore();
  const { data: freshUser, isLoading: isUserLoading } = useCurrentUser();
  const updateUser = useUpdateUser();

  const user = freshUser ?? currentUser;

  const imageUpload = useImageUpload({
    onSuccess: (url) => {
      if (user) {
        updateUser.mutate(
          { id: user.id, data: { profileImageURL: url } },
          { onSuccess: () => toast.success("Profile photo updated") }
        );
      }
    },
    onError: () => toast.error("Failed to upload photo"),
  });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  useEffect(() => {
    if (user) {
      setName(getUserFullName(user));
      setEmail(user.email ?? "");
      setPhone(user.phone ?? "");
    }
  }, [user]);

  async function handleSave() {
    if (!user) return;

    const trimmedName = name.trim();
    const parts = trimmedName.split(/\s+/);
    const firstName = parts[0] || "";
    const lastName = parts.slice(1).join(" ") || "";

    updateUser.mutate(
      {
        id: user.id,
        data: {
          firstName,
          lastName,
          phone: phone.trim() || null,
        },
      },
      {
        onSuccess: () => {
          toast.success("Profile updated successfully");
        },
        onError: (error) => {
          toast.error("Failed to update profile", {
            description: error instanceof Error ? error.message : "Please try again.",
          });
        },
      }
    );
  }

  if (isUserLoading && !user) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-[24px] h-[24px] text-ops-accent animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-3 max-w-[600px]">
      <Card>
        <CardContent className="flex items-center gap-2 p-2">
          <div className="relative">
            <div className="w-[72px] h-[72px] rounded-full bg-ops-accent-muted flex items-center justify-center overflow-hidden">
              {user?.profileImageURL ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={user.profileImageURL}
                  alt=""
                  className="w-full h-full object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <span className="font-mohave text-display text-ops-accent">
                  {name?.charAt(0)?.toUpperCase() || "U"}
                </span>
              )}
            </div>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="absolute bottom-0 right-0 w-[24px] h-[24px] rounded-full bg-ops-accent flex items-center justify-center hover:bg-ops-accent-hover transition-colors"
            >
              <Camera className="w-[14px] h-[14px] text-white" />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) imageUpload.selectFile(file);
              }}
            />
          </div>
          <div>
            <h3 className="font-mohave text-card-title text-text-primary">{name || "Your Name"}</h3>
            <p className="font-mono text-data-sm text-text-tertiary">{email}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Profile Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Input
            label="Full Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
          />
          <Input
            label="Email"
            value={email}
            disabled
            helperText="Email cannot be changed"
          />
          <Input
            label="Phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="(555) 123-4567"
          />
          <Input
            label="Role"
            value={useAuthStore.getState().role}
            disabled
            helperText="Role is managed by your company admin"
          />
          <div className="pt-1">
            <Button onClick={handleSave} loading={updateUser.isPending} className="gap-[6px]">
              <Save className="w-[16px] h-[16px]" />
              Save Changes
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
