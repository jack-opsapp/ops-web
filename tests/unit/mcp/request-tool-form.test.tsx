import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RequestToolForm } from "@/app/developers/mcp/_components/request-tool-form";
import copy from "@/i18n/dictionaries/en/mcp-docs.json";

const ENDPOINT = "/api/developers/mcp/tool-requests";
const EMAIL = "owner@example.com";
const DETAILS =
  "Show the latest site visit evidence that still needs follow-up.";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function renderForm() {
  return render(<RequestToolForm copy={copy} />);
}

async function completeVisibleFields(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByRole("textbox", { name: "Work email" }), EMAIL);
  await user.type(
    screen.getByRole("textbox", { name: "What should the tool do?" }),
    DETAILS
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("RequestToolForm", () => {
  it("renders exactly two visible fields with linked safety guidance and a hidden honeypot", () => {
    renderForm();

    const form = screen.getByRole("form", { name: "Request a tool" });
    const email = within(form).getByRole("textbox", { name: "Work email" });
    const details = within(form).getByRole("textbox", {
      name: "What should the tool do?",
    });
    const safety = within(form).getByText(
      "Do not send passwords, access tokens, or customer records."
    );

    expect(within(form).getAllByRole("textbox")).toHaveLength(2);
    expect(form).toHaveAttribute("method", "post");
    expect(form).toHaveAttribute("action", ENDPOINT);
    expect(email).toBeRequired();
    expect(details).toBeRequired();
    expect(details).toHaveAttribute("maxlength", "4000");
    expect(details.getAttribute("aria-describedby")?.split(/\s+/)).toContain(
      safety.id
    );

    const honeypot = form.querySelector<HTMLInputElement>(
      'input[name="website"]'
    );
    expect(honeypot).not.toBeNull();
    expect(honeypot).toHaveAttribute("aria-hidden", "true");
    expect(honeypot).toHaveAttribute("tabindex", "-1");
  });

  it("shows linked inline errors and does not post invalid values", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderForm();

    await user.click(screen.getByRole("button", { name: "Send request" }));

    const email = screen.getByRole("textbox", { name: "Work email" });
    const details = screen.getByRole("textbox", {
      name: "What should the tool do?",
    });
    const emailError = screen.getByText("Enter your work email.");
    const detailsError = screen.getByText(
      "Describe the tool you need in at least 20 characters."
    );

    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(details).toHaveAttribute("aria-invalid", "true");
    expect(email).toHaveClass("border-rose-line");
    expect(details).toHaveClass("border-rose-line");
    expect(email.getAttribute("aria-describedby")?.split(/\s+/)).toContain(
      emailError.id
    );
    expect(details.getAttribute("aria-describedby")?.split(/\s+/)).toContain(
      detailsError.id
    );
    expect(email).toHaveFocus();
    expect(fetchMock).not.toHaveBeenCalled();

    await user.type(email, "not-an-email");
    await user.type(details, "Too short");
    await user.click(screen.getByRole("button", { name: "Send request" }));
    expect(screen.getByText("Enter a valid work email.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts the exact bounded payload and announces success", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body)) as {
        submissionId: string;
      };
      return jsonResponse(201, {
        ok: true,
        submissionId: payload.submissionId,
        replayed: false,
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    renderForm();
    await completeVisibleFields(user);

    await user.click(screen.getByRole("button", { name: "Send request" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    const payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(url).toBe(ENDPOINT);
    expect(init).toMatchObject({
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    expect(payload).toEqual({
      submissionId: expect.stringMatching(UUID_PATTERN),
      email: EMAIL,
      details: DETAILS,
      website: "",
    });
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("Request received");
    expect(status).toHaveTextContent(
      "OPS will review it and use your email if more detail is needed."
    );
  });

  it.each([
    ["an empty response", new Response(null, { status: 200 })],
    [
      "a mismatched submission",
      jsonResponse(200, {
        ok: true,
        submissionId: "22222222-2222-4222-8222-222222222222",
        replayed: false,
      }),
    ],
    [
      "an invalid success shape",
      jsonResponse(200, {
        ok: false,
        submissionId: "11111111-1111-4111-8111-111111111111",
      }),
    ],
  ])(
    "keeps the request retryable after %s with a 2xx status",
    async (_label, response) => {
      const user = userEvent.setup();
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
      renderForm();
      await completeVisibleFields(user);

      await user.click(screen.getByRole("button", { name: "Send request" }));

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Request not sent. Check your connection and try again."
      );
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
      expect(screen.getByRole("textbox", { name: "Work email" })).toHaveValue(
        EMAIL
      );
      expect(
        screen.getByRole("textbox", { name: "What should the tool do?" })
      ).toHaveValue(DETAILS);
    }
  );

  it("disables submission while pending", async () => {
    const user = userEvent.setup();
    let resolveResponse!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      resolveResponse = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => pending)
    );
    renderForm();
    await completeVisibleFields(user);

    await user.click(screen.getByRole("button", { name: "Send request" }));

    expect(
      screen.getByRole("form", { name: "Request a tool" })
    ).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: /sending/i })).toBeDisabled();

    await act(async () => {
      resolveResponse(
        jsonResponse(201, {
          ok: true,
          submissionId: "11111111-1111-4111-8111-111111111111",
          replayed: false,
        })
      );
    });
  });

  it("stops waiting on a stalled request without clearing the fields", async () => {
    vi.useFakeTimers();
    let submittedSignal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        submittedSignal = init?.signal ?? undefined;
        return new Promise<Response>((_resolve, reject) => {
          submittedSignal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        });
      })
    );
    renderForm();
    fireEvent.change(screen.getByRole("textbox", { name: "Work email" }), {
      target: { value: EMAIL },
    });
    fireEvent.change(
      screen.getByRole("textbox", { name: "What should the tool do?" }),
      { target: { value: DETAILS } }
    );

    fireEvent.submit(screen.getByRole("form", { name: "Request a tool" }));
    expect(screen.getByRole("button", { name: /sending/i })).toBeDisabled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });

    expect(submittedSignal?.aborted).toBe(true);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Request not sent. Check your connection and try again."
    );
    expect(screen.getByRole("textbox", { name: "Work email" })).toHaveValue(
      EMAIL
    );
    expect(
      screen.getByRole("textbox", { name: "What should the tool do?" })
    ).toHaveValue(DETAILS);
  });

  it("preserves values and reuses one submission ID across a retry", async () => {
    const user = userEvent.setup();
    const payloads: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
      payloads.push(payload);
      return payloads.length === 1
        ? jsonResponse(500, { error: "request_failed" })
        : jsonResponse(201, {
            ok: true,
            submissionId: payload.submissionId,
            replayed: false,
          });
    });
    vi.stubGlobal("fetch", fetchMock);
    renderForm();
    await completeVisibleFields(user);

    await user.click(screen.getByRole("button", { name: "Send request" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Request not sent. Check your connection and try again."
    );
    expect(screen.getByRole("textbox", { name: "Work email" })).toHaveValue(
      EMAIL
    );
    expect(
      screen.getByRole("textbox", { name: "What should the tool do?" })
    ).toHaveValue(DETAILS);

    await user.click(screen.getByRole("button", { name: "Send request" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(payloads[0].submissionId).toMatch(UUID_PATTERN);
    expect(payloads[1].submissionId).toBe(payloads[0].submissionId);
  });

  it("gives rate limiting its own actionable error", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(429, { error: "rate_limited" }))
    );
    renderForm();
    await completeVisibleFields(user);

    await user.click(screen.getByRole("button", { name: "Send request" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Too many requests. Try again later."
    );
  });

  it("includes a bot-filled honeypot in the server-owned rejection payload", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse(201, {
        ok: true,
        submissionId: "11111111-1111-4111-8111-111111111111",
        replayed: false,
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const { container } = renderForm();
    await completeVisibleFields(user);
    fireEvent.change(container.querySelector('input[name="website"]')!, {
      target: { value: "https://spam.example" },
    });

    await user.click(screen.getByRole("button", { name: "Send request" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const payload = JSON.parse(
      String(fetchMock.mock.calls[0][1]?.body)
    ) as Record<string, unknown>;
    expect(payload.website).toBe("https://spam.example");
  });
});
