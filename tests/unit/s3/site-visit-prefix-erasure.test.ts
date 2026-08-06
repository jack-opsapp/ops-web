import { beforeEach, describe, expect, it, vi } from "vitest";

const COMPANY = "11111111-1111-4111-8111-111111111111";
const FOREIGN = "22222222-2222-4222-8222-222222222222";

const { ListObjectsV2Command, DeleteObjectsCommand, sendMock } = vi.hoisted(
  () => {
    class ListObjectsV2Command {
      readonly input: Record<string, unknown>;
      constructor(input: Record<string, unknown>) {
        this.input = input;
      }
    }

    class DeleteObjectsCommand {
      readonly input: Record<string, unknown>;
      constructor(input: Record<string, unknown>) {
        this.input = input;
      }
    }

    return { ListObjectsV2Command, DeleteObjectsCommand, sendMock: vi.fn() };
  }
);

vi.mock("@aws-sdk/client-s3", () => ({
  ListObjectsV2Command,
  DeleteObjectsCommand,
}));

vi.mock("@/lib/s3/client", () => ({
  getS3Client: () => ({ send: sendMock }),
  S3_BUCKET: "ops-test-bucket",
}));

import {
  eraseSiteVisitPrefix,
  siteVisitCompanyPrefix,
} from "@/lib/s3/site-visit-prefix-erasure";

beforeEach(() => {
  sendMock.mockReset();
});

describe("site-visit S3 prefix erasure", () => {
  it("derives only an exact canonical company prefix", () => {
    expect(siteVisitCompanyPrefix(COMPANY)).toBe(`site-visits/${COMPANY}/`);
    for (const unsafe of [
      "",
      "../",
      "SITE",
      "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
    ]) {
      expect(() => siteVisitCompanyPrefix(unsafe)).toThrow(
        "invalid_site_visit_company_id"
      );
    }
  });

  it("paginates and deletes only keys returned under the exact company prefix", async () => {
    sendMock.mockImplementation(async (command: unknown) => {
      if (command instanceof ListObjectsV2Command) {
        const token = command.input.ContinuationToken;
        if (!token) {
          return {
            Contents: [
              { Key: `site-visits/${COMPANY}/visit-a/a/original.jpg` },
              { Key: `site-visits/${COMPANY}/visit-a/a/thumbnail.jpg` },
            ],
            IsTruncated: true,
            NextContinuationToken: "page-2",
          };
        }
        return {
          Contents: [
            { Key: `site-visits/${COMPANY}/visit-b/b/rendered.jpg` },
          ],
          IsTruncated: false,
        };
      }
      if (command instanceof DeleteObjectsCommand) return { Errors: [] };
      throw new Error("unexpected command");
    });

    const result = await eraseSiteVisitPrefix(COMPANY);

    expect(result).toEqual({ prefix: `site-visits/${COMPANY}/`, pages: 2, deleted: 3 });
    const lists = sendMock.mock.calls
      .map(([command]) => command)
      .filter((command) => command instanceof ListObjectsV2Command);
    expect(lists.map((command) => command.input)).toEqual([
      {
        Bucket: "ops-test-bucket",
        Prefix: `site-visits/${COMPANY}/`,
        MaxKeys: 1000,
      },
      {
        Bucket: "ops-test-bucket",
        Prefix: `site-visits/${COMPANY}/`,
        MaxKeys: 1000,
        ContinuationToken: "page-2",
      },
    ]);
    const deletedKeys = sendMock.mock.calls
      .map(([command]) => command)
      .filter((command) => command instanceof DeleteObjectsCommand)
      .flatMap(
        (command) =>
          ((command.input.Delete as { Objects: Array<{ Key: string }> }).Objects)
      )
      .map((object) => object.Key);
    expect(deletedKeys).not.toContain(
      `site-visits/${FOREIGN}/visit-a/a/original.jpg`
    );
  });

  it("treats an empty prefix and a second run as success", async () => {
    sendMock.mockResolvedValue({ Contents: [], IsTruncated: false });

    const first = await eraseSiteVisitPrefix(COMPANY);
    const second = await eraseSiteVisitPrefix(COMPANY);

    expect(first.deleted).toBe(0);
    expect(second.deleted).toBe(0);
    expect(
      sendMock.mock.calls.some(
        ([command]) => command instanceof DeleteObjectsCommand
      )
    ).toBe(false);
  });

  it("fails a partial S3 delete so the caller can retry the same prefix", async () => {
    let deleteAttempts = 0;
    sendMock.mockImplementation(async (command: unknown) => {
      if (command instanceof ListObjectsV2Command) {
        return {
          Contents: [
            { Key: `site-visits/${COMPANY}/visit-a/a/original.jpg` },
          ],
          IsTruncated: false,
        };
      }
      deleteAttempts += 1;
      return deleteAttempts === 1
        ? { Errors: [{ Key: `site-visits/${COMPANY}/visit-a/a/original.jpg` }] }
        : { Errors: [] };
    });

    await expect(eraseSiteVisitPrefix(COMPANY)).rejects.toThrow(
      "site_visit_prefix_delete_incomplete"
    );
    await expect(eraseSiteVisitPrefix(COMPANY)).resolves.toMatchObject({
      deleted: 1,
    });
  });
});
