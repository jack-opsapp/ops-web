import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement, Fragment, useState, type ChangeEvent } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getQueryClient,
  getQueryClientSecurityEpoch,
  quarantineCurrentActorQueryCache,
  redactAllQueryCacheData,
} from "@/lib/api/query-client";

describe("query client security boundary", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("quarantines a late mutation callback in an abandoned actor cache", async () => {
    const actorAClient = getQueryClient();
    actorAClient.clear();
    const secretKey = ["opportunity", "lead-a"];
    let resolveMutation!: (value: { secret: string }) => void;
    const pending = new Promise<{ secret: string }>((resolve) => {
      resolveMutation = resolve;
    });
    const mutation = actorAClient.getMutationCache().build(actorAClient, {
      mutationFn: () => pending,
      onSuccess: (data) => actorAClient.setQueryData(secretKey, data),
    });
    const execution = mutation.execute(undefined);
    await Promise.resolve();

    const epochBefore = getQueryClientSecurityEpoch();
    const actorBClient = redactAllQueryCacheData(actorAClient);
    expect(actorBClient).not.toBe(actorAClient);
    expect(getQueryClient()).toBe(actorBClient);
    expect(getQueryClientSecurityEpoch()).toBe(epochBefore + 1);
    expect(actorBClient.getQueryData(secretKey)).toBeUndefined();

    resolveMutation({ secret: "actor A" });
    await execution;

    // The callback did execute, proving clear() alone would have leaked, but
    // it wrote only to the quarantined client no longer mounted by OPS.
    expect(actorAClient.getQueryData(secretKey)).toEqual({ secret: "actor A" });
    expect(getQueryClient()).toBe(actorBClient);
    expect(actorBClient.getQueryData(secretKey)).toBeUndefined();
  });

  it("redacts late same-actor mutation writes without replacing the client", async () => {
    const client = new QueryClient();
    const secretKey = ["opportunity", "revoked-lead"];
    let resolveMutation!: (value: { secret: string }) => void;
    const pending = new Promise<{ secret: string }>((resolve) => {
      resolveMutation = resolve;
    });
    const mutation = client.getMutationCache().build(client, {
      mutationFn: () => pending,
      onSuccess: (data) => client.setQueryData(secretKey, data),
    });
    const execution = mutation.execute(undefined);
    await Promise.resolve();

    const epochBefore = getQueryClientSecurityEpoch();
    const quarantine = quarantineCurrentActorQueryCache(client);
    expect(quarantine.queryClient).toBe(client);
    expect(getQueryClientSecurityEpoch()).toBe(epochBefore);

    resolveMutation({ secret: "late revoked lead" });
    await execution;
    await quarantine.settled;

    expect(client.getQueryData(secretKey)).toBeUndefined();
    client.setQueryData(secretKey, { allowed: "fresh authority" });
    expect(client.getQueryData(secretKey)).toEqual({
      allowed: "fresh authority",
    });
  });

  it("captures a mutation started immediately after a same-actor boundary", async () => {
    const client = new QueryClient();
    const secretKey = ["opportunity", "concurrently-revoked-lead"];
    let resolveMutation!: (value: { secret: string }) => void;
    const pending = new Promise<{ secret: string }>((resolve) => {
      resolveMutation = resolve;
    });

    const quarantine = quarantineCurrentActorQueryCache(client);
    const mutation = client.getMutationCache().build(client, {
      mutationFn: () => pending,
      onSuccess: (data) => client.setQueryData(secretKey, data),
    });
    const execution = mutation.execute(undefined);

    resolveMutation({ secret: "started after revocation" });
    await execution;
    await quarantine.settled;

    expect(client.getQueryData(secretKey)).toBeUndefined();
  });

  it("replaces the client when a pre-boundary mutation never settles", async () => {
    vi.useFakeTimers();
    const client = getQueryClient();
    client.clear();
    const neverSettles = new Promise<never>(() => undefined);
    const mutation = client.getMutationCache().build(client, {
      mutationFn: () => neverSettles,
    });
    void mutation.execute(undefined);
    await Promise.resolve();

    const epochBefore = getQueryClientSecurityEpoch();
    const quarantine = quarantineCurrentActorQueryCache(client);

    await vi.advanceTimersByTimeAsync(10_000);
    await quarantine.settled;

    expect(quarantine.queryClient).not.toBe(client);
    expect(getQueryClient()).toBe(quarantine.queryClient);
    expect(getQueryClientSecurityEpoch()).toBe(epochBefore + 1);
  });

  it("preserves unrelated human input across a same-actor quarantine", async () => {
    const user = userEvent.setup();
    const client = new QueryClient();

    function UnrelatedWorkForm() {
      const [value, setValue] = useState("");
      return createElement(
        Fragment,
        null,
        createElement("input", {
          "aria-label": "Estimate notes",
          value,
          onChange: (event: ChangeEvent<HTMLInputElement>) =>
            setValue(event.target.value),
        }),
        createElement(
          "button",
          {
            type: "button",
            onClick: () => quarantineCurrentActorQueryCache(client),
          },
          "Revoke another lead"
        )
      );
    }

    render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(UnrelatedWorkForm)
      )
    );
    await user.type(
      screen.getByRole("textbox", { name: "Estimate notes" }),
      "Keep this unsaved estimate"
    );
    await user.click(
      screen.getByRole("button", { name: "Revoke another lead" })
    );

    expect(screen.getByRole("textbox", { name: "Estimate notes" })).toHaveValue(
      "Keep this unsaved estimate"
    );
  });
});
