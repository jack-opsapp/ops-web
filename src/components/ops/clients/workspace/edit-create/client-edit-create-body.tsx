"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Crosshair, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { useDictionary } from "@/i18n/client";
import { useClient, type useCreateClient, type useUpdateClient } from "@/lib/hooks";
import { useAuthStore } from "@/lib/store/auth-store";
import { useGeolocationAddress } from "@/lib/hooks/use-geolocation-address";
import { Stack } from "@/components/ops/projects/workspace/atoms/stack";
import { Section } from "@/components/ops/projects/workspace/atoms/section";
import { Field } from "@/components/ops/projects/workspace/atoms/field";
import { TextInput } from "@/components/ops/projects/workspace/atoms/text-input";
import { TextArea } from "@/components/ops/projects/workspace/atoms/text-area";
import { Mono } from "@/components/ops/projects/workspace/atoms/mono";
import { Body } from "@/components/ops/projects/workspace/atoms/body";

export interface ClientEditCreateBodyHandle {
  discard: () => void;
}

// US phone auto-format — mirrors the create/edit modal formatter so the
// behaviour is identical wherever a client is captured.
function formatPhoneInput(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  if (digits.length <= 10)
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  if (digits.length === 11 && digits.startsWith("1"))
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  return value;
}

const EMPTY = { name: "", email: "", phone: "", address: "", notes: "" };

export const ClientEditCreateBody = React.forwardRef<
  ClientEditCreateBodyHandle,
  {
    mode: "editing" | "creating";
    clientId: string | null;
    formId: string;
    onSaved: (clientId: string) => void;
    // Mutations are owned by the container (single source of truth) so the
    // footer SAVE/CREATE can disable while the request is in flight.
    createClient: ReturnType<typeof useCreateClient>;
    updateClient: ReturnType<typeof useUpdateClient>;
  }
>(function ClientEditCreateBody(
  { mode, clientId, formId, onSaved, createClient, updateClient },
  ref,
) {
  const { t } = useDictionary("clients");
  const { company } = useAuthStore();
  const isEditing = mode === "editing";

  const schema = React.useMemo(
    () =>
      z.object({
        name: z.string().min(1, t("form.nameRequired")).max(200),
        email: z.string().email(t("form.emailInvalid")).optional().or(z.literal("")),
        phone: z.string().optional(),
        address: z.string().optional(),
        notes: z.string().optional(),
      }),
    [t],
  );
  type FormValues = z.infer<typeof schema>;

  const { data: client } = useClient(isEditing && clientId ? clientId : undefined);
  const geo = useGeolocationAddress();
  const [serverError, setServerError] = React.useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: EMPTY,
    mode: "onBlur",
  });

  // Prefill on edit once the client row arrives.
  React.useEffect(() => {
    if (isEditing && client) {
      reset({
        name: client.name ?? "",
        email: client.email ?? "",
        phone: client.phoneNumber ?? "",
        address: client.address ?? "",
        notes: client.notes ?? "",
      });
    }
  }, [isEditing, client, reset]);

  React.useImperativeHandle(ref, () => ({
    discard: () => {
      if (isEditing && client) {
        reset({
          name: client.name ?? "",
          email: client.email ?? "",
          phone: client.phoneNumber ?? "",
          address: client.address ?? "",
          notes: client.notes ?? "",
        });
      } else {
        reset(EMPTY);
      }
      setServerError(null);
    },
  }));

  const phoneValue = watch("phone");
  const addressValue = watch("address");

  const onSubmit = (data: FormValues) => {
    setServerError(null);
    const fail = () => {
      setServerError(t("form.saveFailed"));
      toast.error(t("form.saveFailed"));
    };

    if (isEditing && clientId) {
      updateClient.mutate(
        {
          id: clientId,
          data: {
            name: data.name,
            email: data.email || null,
            phoneNumber: data.phone || null,
            address: data.address || null,
            notes: data.notes || null,
          },
        },
        {
          onSuccess: () => {
            toast.success(t("toast.updated"));
            onSaved(clientId);
          },
          onError: fail,
        },
      );
    } else {
      createClient.mutate(
        {
          name: data.name,
          email: data.email || null,
          phoneNumber: data.phone || null,
          address: data.address || null,
          notes: data.notes || null,
          companyId: company?.id ?? "",
        },
        {
          onSuccess: (created) => {
            toast.success(t("toast.created"));
            onSaved(created.id);
          },
          onError: fail,
        },
      );
    }
  };

  const useMyLocation = async () => {
    const addr = await geo.getAddress();
    if (addr) setValue("address", addr, { shouldDirty: true, shouldValidate: false });
  };

  if (isEditing && !client) {
    return (
      <div className="p-5">
        <Mono size={11} color="mute">
          —
        </Mono>
      </div>
    );
  }

  return (
    <form id={formId} onSubmit={handleSubmit(onSubmit)} className="p-5">
      <Stack gap={3}>
        {serverError && (
          <div
            role="alert"
            className="flex items-center gap-1.5 rounded-[5px] border border-rose-line bg-rose-soft px-2 py-1.5"
          >
            <AlertCircle className="h-[14px] w-[14px] shrink-0 text-rose" aria-hidden />
            <Body size={14} color="rose">
              {serverError}
            </Body>
          </div>
        )}

        <Section title={t("form.basicInfo")}>
          <Field label={t("form.nameLabel")} required error={errors.name?.message}>
            <TextInput placeholder={t("form.namePlaceholder")} {...register("name")} />
          </Field>
        </Section>

        <Section title={t("form.contactDetails")}>
          <Stack gap={1.5}>
            <Field label={t("form.emailLabel")} optional error={errors.email?.message}>
              <TextInput
                type="email"
                placeholder={t("form.emailPlaceholder")}
                {...register("email")}
              />
            </Field>
            <Field label={t("form.phoneLabel")} optional hint={t("form.phoneHelper")}>
              <TextInput
                type="tel"
                placeholder={t("form.phonePlaceholder")}
                value={phoneValue ?? ""}
                onChange={(e) =>
                  setValue("phone", formatPhoneInput(e.target.value), {
                    shouldValidate: false,
                    shouldDirty: true,
                  })
                }
              />
            </Field>
            <Field label={t("form.addressLabel")} optional>
              <div className="flex items-center gap-1.5">
                <TextInput
                  className="flex-1"
                  placeholder={t("form.addressPlaceholder")}
                  value={addressValue ?? ""}
                  onChange={(e) =>
                    setValue("address", e.target.value, { shouldDirty: true })
                  }
                />
                <button
                  type="button"
                  onClick={useMyLocation}
                  disabled={geo.loading}
                  aria-label={t("form.useLocation")}
                  title={t("form.useLocation")}
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[5px] border border-glass-border text-text-3 transition-colors hover:border-glass-border-medium hover:text-text-2 focus-visible:outline-none focus-visible:ring-[1.5px] focus-visible:ring-ops-accent disabled:opacity-40"
                >
                  <Crosshair className="h-[15px] w-[15px]" aria-hidden />
                </button>
              </div>
            </Field>
          </Stack>
        </Section>

        <Section title={t("form.notes")}>
          <Field label={t("form.notesLabel")} optional>
            <TextArea placeholder={t("form.notesPlaceholder")} {...register("notes")} />
          </Field>
        </Section>
      </Stack>
    </form>
  );
});
