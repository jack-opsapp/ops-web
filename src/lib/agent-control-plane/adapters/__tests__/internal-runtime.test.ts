import { describe, expect, it, vi } from "vitest";

import { createOperationalReadCursorCodec } from "@/lib/agent-control-plane/services/operational-read-cursor";
import { createInternalPhaseCAdapterRuntime } from "../internal-runtime";

const CURSOR_KEY = new Uint8Array(32).fill(23);

function cursorCodec() {
  return createOperationalReadCursorCodec({
    key: CURSOR_KEY,
    keyId: "phase-c-runtime",
    version: 1,
  });
}

describe("internal Phase C adapter runtime", () => {
  it("constructs both trusted read catalogues without reading", () => {
    const rpc = vi.fn();

    const adapter = createInternalPhaseCAdapterRuntime({
      rpcClient: { rpc },
      cursorCodec: cursorCodec(),
      p2CursorKey: { keyId: "phase-c-p2", key: CURSOR_KEY },
    });

    expect(Object.isFrozen(adapter)).toBe(true);
    expect(typeof adapter.getJobConversationContext).toBe("function");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects a structural cursor codec before reading", () => {
    const rpc = vi.fn();
    const structuralCopy = { ...cursorCodec() };

    expect(() =>
      createInternalPhaseCAdapterRuntime({
        rpcClient: { rpc },
        cursorCodec: structuralCopy as ReturnType<typeof cursorCodec>,
        p2CursorKey: { keyId: "phase-c-p2", key: CURSOR_KEY },
      })
    ).toThrow(TypeError);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects a malformed P2 cursor key before reading", () => {
    const rpc = vi.fn();

    expect(() =>
      createInternalPhaseCAdapterRuntime({
        rpcClient: { rpc },
        cursorCodec: cursorCodec(),
        p2CursorKey: {
          keyId: "phase-c-p2",
          key: new Uint8Array(31).fill(23),
        },
      })
    ).toThrow(TypeError);
    expect(rpc).not.toHaveBeenCalled();
  });
});
