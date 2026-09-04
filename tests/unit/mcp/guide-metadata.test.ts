import { beforeEach, describe, expect, it, vi } from "vitest";

const { getLocaleMock } = vi.hoisted(() => ({
  getLocaleMock: vi.fn<() => Promise<"en" | "es">>(),
}));

vi.mock("@/i18n/server", () => ({
  getLocale: getLocaleMock,
}));

vi.mock("server-only", () => ({}));

import { generateMetadata } from "@/app/developers/mcp/page";

describe("public MCP guide metadata", () => {
  beforeEach(() => {
    getLocaleMock.mockReset();
  });

  it("uses Spanish metadata when the page locale is Spanish", async () => {
    getLocaleMock.mockResolvedValue("es");

    await expect(generateMetadata()).resolves.toMatchObject({
      title: "Guía del servidor MCP de OPS",
      description:
        "Conecta Codex, Claude o ChatGPT al servidor MCP de OPS de solo lectura y consulta las herramientas, permisos, seguridad y flujos verificados.",
      openGraph: {
        title: "Guía del servidor MCP de OPS",
        description:
          "Conecta Codex, Claude o ChatGPT al servidor MCP de OPS de solo lectura y consulta las herramientas, permisos, seguridad y flujos verificados.",
      },
    });
    expect(getLocaleMock).toHaveBeenCalledOnce();
  });
});
