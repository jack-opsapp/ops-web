import { describe, it, expect } from "vitest";
import { extractMentionedUserIds, parseMentions } from "../mention-textarea";

const ALICE_ID = "11111111-1111-4111-8111-111111111111";
const BOB_ID = "22222222-2222-4222-8222-222222222222";
const CHARLIE_ID = "33333333-3333-4333-8333-333333333333";
const OUTSIDER_ID = "44444444-4444-4444-8444-444444444444";
const roster = [{ id: ALICE_ID }, { id: BOB_ID }, { id: CHARLIE_ID }];

describe("mention parsing", () => {
  it("extracts user IDs from mention syntax", () => {
    const text = `Hey @[Alice Able](${ALICE_ID}) and @[Bob Builder](${BOB_ID}), check this out`;
    const ids = extractMentionedUserIds(text, roster);
    expect(ids).toEqual([ALICE_ID, BOB_ID]);
  });

  it("returns empty array for no mentions", () => {
    const ids = extractMentionedUserIds("Just a regular note", roster);
    expect(ids).toEqual([]);
  });

  it("handles duplicate mentions", () => {
    const text = `@[Alice Able](${ALICE_ID}) said hi to @[Alice Able](${ALICE_ID})`;
    const ids = extractMentionedUserIds(text, roster);
    expect(ids).toEqual([ALICE_ID]);
  });

  it("expands the exact persisted All Team sentinel in roster order", () => {
    const ids = extractMentionedUserIds(
      "Check this now @[All Team](all-team)",
      roster
    );

    expect(ids).toEqual([ALICE_ID, BOB_ID, CHARLIE_ID]);
  });

  it("preserves textual order while deduping mixed individual and group mentions", () => {
    const ids = extractMentionedUserIds(
      `@[Bob Builder](${BOB_ID}) then @[All Team](all-team) then @[Alice Able](${ALICE_ID})`,
      roster
    );

    expect(ids).toEqual([BOB_ID, ALICE_ID, CHARLIE_ID]);
  });

  it("does not expand malformed or similar All Team sentinels", () => {
    const ids = extractMentionedUserIds(
      [
        "@[All Team](all-team-extra)",
        "@[All Team](ALL-TEAM)",
        "@[All team](all-team)",
        "@[Everyone](all-team)",
      ].join(" "),
      roster
    );

    expect(ids).toEqual([]);
  });

  it("ignores an ordinary embedded user ID outside the active roster", () => {
    const ids = extractMentionedUserIds(
      `@[Outside User](${OUTSIDER_ID}) and @[Alice Able](${ALICE_ID})`,
      roster
    );

    expect(ids).toEqual([ALICE_ID]);
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
