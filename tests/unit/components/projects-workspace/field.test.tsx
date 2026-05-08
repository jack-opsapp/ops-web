import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({ t: (k: string) => k }),
}));

import { Field } from "@/components/ops/projects/workspace/atoms/field";

// `Field` — label + child + optional/required/hint/error wrapper. Owns the
// workspace label voice (Mono uppercase 9.5px tracked-out). Auto-generates
// an id and wires `htmlFor` ↔ `id` so the child <input> / <textarea> /
// custom control can stay agnostic of label semantics.

describe("<Field>", () => {
  it("renders the label as Mono uppercase tracked-out", () => {
    render(
      <Field label="Project name">
        <input data-testid="input" />
      </Field>,
    );
    const label = screen.getByText("Project name");
    expect(label.tagName).toBe("LABEL");
    expect(label).toHaveClass("font-mono");
    expect(label).toHaveClass("uppercase");
    expect(label).toHaveClass("tracking-[0.18em]");
  });

  it("wires htmlFor to a generated id and applies it to the child input", () => {
    render(
      <Field label="Project name">
        <input data-testid="input" />
      </Field>,
    );
    const label = screen.getByText("Project name");
    const input = screen.getByTestId("input");
    const htmlFor = label.getAttribute("for");
    expect(htmlFor).toBeTruthy();
    expect(input).toHaveAttribute("id", htmlFor!);
  });

  it("respects an explicit child id over the generated one", () => {
    render(
      <Field label="Name">
        <input data-testid="input" id="explicit-id" />
      </Field>,
    );
    expect(screen.getByText("Name")).toHaveAttribute("for", "explicit-id");
    expect(screen.getByTestId("input")).toHaveAttribute("id", "explicit-id");
  });

  it("renders an [optional] tag when optional=true", () => {
    render(
      <Field label="Notes" optional>
        <input />
      </Field>,
    );
    // Field resolves the "[optional]" label via the project-workspace
    // dictionary — the test mock returns the key string directly.
    expect(screen.getByText("field.optional")).toBeInTheDocument();
  });

  it("renders a * required marker when required=true", () => {
    render(
      <Field label="Email" required>
        <input />
      </Field>,
    );
    const star = screen.getByText("*");
    expect(star).toBeInTheDocument();
    // Required marker uses rose to read as urgent without screaming.
    expect(star).toHaveClass("text-[var(--rose)]");
  });

  it("renders a hint message when hint is provided and no error", () => {
    render(
      <Field label="Name" hint="Up to 80 characters">
        <input />
      </Field>,
    );
    expect(screen.getByText("Up to 80 characters")).toBeInTheDocument();
  });

  it("renders error message in rose when error is provided, suppressing the hint", () => {
    render(
      <Field label="Name" hint="hint goes here" error="Name is required">
        <input />
      </Field>,
    );
    expect(screen.getByText("Name is required")).toBeInTheDocument();
    expect(screen.queryByText("hint goes here")).not.toBeInTheDocument();
    const errorEl = screen.getByText("Name is required");
    expect(errorEl).toHaveClass("text-[var(--rose)]");
    expect(errorEl).toHaveAttribute("role", "alert");
  });

  it("links the input to the error via aria-describedby", () => {
    render(
      <Field label="Name" error="Required">
        <input data-testid="input" />
      </Field>,
    );
    const input = screen.getByTestId("input");
    const describedBy = input.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toHaveTextContent("Required");
    expect(input).toHaveAttribute("aria-invalid", "true");
  });

  it("links the input to the hint via aria-describedby when no error", () => {
    render(
      <Field label="Name" hint="A short label">
        <input data-testid="input" />
      </Field>,
    );
    const describedBy = screen.getByTestId("input").getAttribute("aria-describedby");
    expect(document.getElementById(describedBy!)).toHaveTextContent("A short label");
  });

  it("merges additional className onto the wrapper", () => {
    render(
      <Field label="Name" className="my-2" data-testid="field">
        <input />
      </Field>,
    );
    expect(screen.getByTestId("field")).toHaveClass("my-2");
  });
});
