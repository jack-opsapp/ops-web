import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LanguageProvider, useDictionary } from "@/i18n/client";

function Probe() {
  const { t } = useDictionary("accounting");
  // qbo.needsReviewBlock = "Resolve {count} flagged customers (link, create, or skip) before applying."
  return <span>{t("qbo.needsReviewBlock", { count: 3 })}</span>;
}

describe("client t() interpolation", () => {
  it("substitutes {token} params in the client t()", async () => {
    render(
      <LanguageProvider locale="en">
        <Probe />
      </LanguageProvider>,
    );
    expect(await screen.findByText(/Resolve 3 flagged customers/)).toBeInTheDocument();
    expect(screen.queryByText(/\{count\}/)).not.toBeInTheDocument();
  });
});
