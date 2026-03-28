import { describe, it, expect } from "vitest";
import { extractMentionedUserIds, parseMentions } from "../mention-textarea";

describe("mention parsing", () => {
  it("extracts user IDs from mention syntax", () => {
    const text =
      "Hey @[John Doe](user-1) and @[Jane Smith](user-2), check this out";
    const ids = extractMentionedUserIds(text);
    expect(ids).toEqual(["user-1", "user-2"]);
  });

  it("returns empty array for no mentions", () => {
    const ids = extractMentionedUserIds("Just a regular note");
    expect(ids).toEqual([]);
  });

  it("handles duplicate mentions", () => {
    const text = "@[John](user-1) said hi to @[John](user-1)";
    const ids = extractMentionedUserIds(text);
    expect(ids).toEqual(["user-1"]);
  });

  it("parses mentions into structured parts", () => {
    const text = "Hello @[Alice](u1) world";
    const parts = parseMentions(text);
    expect(parts).toEqual([
      { type: "text", value: "Hello " },
      { type: "mention", name: "Alice", userId: "u1" },
      { type: "text", value: " world" },
    ]);
  });

  it("parses text with no mentions", () => {
    const parts = parseMentions("plain text");
    expect(parts).toEqual([{ type: "text", value: "plain text" }]);
  });
});
