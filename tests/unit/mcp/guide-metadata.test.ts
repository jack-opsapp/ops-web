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
        "Conecta Codex, Claude o ChatGPT con OPS para consultar registros autorizados y preparar cambios exactos de clientes y oportunidades para su aprobación. Consulta herramientas, permisos y verificación.",
      openGraph: {
        title: "Guía del servidor MCP de OPS",
        description:
          "Conecta Codex, Claude o ChatGPT con OPS para consultar registros autorizados y preparar cambios exactos de clientes y oportunidades para su aprobación. Consulta herramientas, permisos y verificación.",
      },
    });
    expect(getLocaleMock).toHaveBeenCalledOnce();
  });
});
