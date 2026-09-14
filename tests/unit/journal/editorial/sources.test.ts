// @vitest-environment node
import { createHash } from "node:crypto";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";

import {
  JournalSourceError,
  extractHtmlSource,
  extractPdfSource,
  fetchJournalSource,
  normaliseSourceText,
} from "@/lib/journal/editorial/sources";
import type { PublicMediaDependencies } from "@/lib/social/public-media";

const publicLookup: PublicMediaDependencies["lookup"] = async () => [
  { address: "93.184.216.34", family: 4 },
];

const PARAGRAPH =
  "Crews that log every site visit the same day recover more billable hours than crews that rebuild the week from memory on Friday afternoon.";

function serving(...responses: Response[]) {
  const fetcher = vi.fn();
  for (const response of responses) fetcher.mockResolvedValueOnce(response);
  return fetcher;
}

function ok(body: BodyInit, contentType: string, headers = {}): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": contentType, ...headers },
  });
}

function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected the promise to reject");
}

async function buildPdf(
  pages: readonly (readonly string[])[],
  title?: string
): Promise<Uint8Array<ArrayBuffer>> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  if (title) document.setTitle(title);
  for (const lines of pages) {
    const page = document.addPage([612, 792]);
    lines.forEach((line, index) =>
      page.drawText(line, { x: 48, y: 730 - index * 18, font, size: 11 })
    );
  }
  // An ArrayBuffer-backed copy, which is what a Response body accepts.
  return Uint8Array.from(await document.save());
}

const ARTICLE_HTML = `<!doctype html>
<html><head>
<title>Fallback title</title>
<meta property="og:title" content="Crew hours &amp; the Friday gap">
<meta property="og:site_name" content="Field Notes">
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebSite","name":"Field Notes","datePublished":"2019-01-01"},{"@type":"NewsArticle","headline":"Crew hours","datePublished":"2026-08-14T09:30:00-07:00","dateModified":"2026-08-20T12:00:00Z"}]}</script>
<script type="application/ld+json">{ this is not json </script>
<style>.promo { display: none }</style>
</head><body>
<nav>Home Pricing Login</nav>
<header><h1>Header headline</h1></header>
<main><article>
<p>Owners said the gap between &ldquo;done&rdquo; and &ldquo;invoiced&rdquo; was the problem.</p><p>Second paragraph&nbsp;with a non-breaking space and    extra   spaces.</p>
<ul><li>First item</li><li>Second item</li></ul>
<p>${PARAGRAPH}</p>
<div hidden>Hidden promo text</div>
<div aria-hidden="true">Decorative text</div>
<script>document.write("script text")</script>
<form><button>Subscribe now</button></form>
</article></main>
<aside>Related reading sidebar</aside>
<footer>Copyright footer text</footer>
</body></html>`;

describe("fetchJournalSource — HTML", () => {
  it("snapshots readable article text, metadata, and the raw body hash", async () => {
    const fetcher = serving(ok(ARTICLE_HTML, "text/html; charset=utf-8"));

    const snapshot = await fetchJournalSource(
      "https://news.example.com/crew-hours",
      { lookup: publicLookup, fetcher }
    );

    expect(snapshot).toMatchObject({
      url: "https://news.example.com/crew-hours",
      final_url: "https://news.example.com/crew-hours",
      http_status: 200,
      content_type: "text/html",
      bytes: Buffer.byteLength(ARTICLE_HTML),
      sha256: sha256(ARTICLE_HTML),
      title: "Crew hours & the Friday gap",
      site_name: "Field Notes",
      published_hint: "2026-08-14T16:30:00.000Z",
      modified_hint: "2026-08-20T12:00:00.000Z",
      truncated: false,
    });
    expect(
      snapshot.text.startsWith(
        "Owners said the gap between “done” and “invoiced” was the problem.\n" +
          "Second paragraph with a non-breaking space and extra spaces.\n" +
          "First item\nSecond item\n" +
          PARAGRAPH
      )
    ).toBe(true);
    for (const removed of [
      "Home Pricing",
      "Header headline",
      "Copyright footer",
      "Related reading",
      "script text",
      "Hidden promo",
      "Decorative text",
      "Subscribe now",
      "display: none",
    ]) {
      expect(snapshot.text).not.toContain(removed);
    }
  });

  it("pins the validated address and sends the source Accept header", async () => {
    const fetcher = serving(ok(ARTICLE_HTML, "text/html"));

    await fetchJournalSource("https://news.example.com/crew-hours", {
      lookup: publicLookup,
      fetcher,
    });

    const [url, init, pinned] = fetcher.mock.calls[0];
    expect(String(url)).toBe("https://news.example.com/crew-hours");
    expect(init.headers).toEqual({
      Accept:
        "text/html,application/xhtml+xml,text/plain;q=0.9,application/pdf;q=0.8",
    });
    expect(init.redirect).toBe("manual");
    expect(pinned).toEqual({ address: "93.184.216.34", family: 4 });
  });

  it("reports application/xhtml+xml as text/html", async () => {
    const fetcher = serving(
      ok(
        `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Spec</title></head><body><p>${PARAGRAPH}</p><p>${PARAGRAPH}</p></body></html>`,
        "application/xhtml+xml; charset=utf-8"
      )
    );

    const snapshot = await fetchJournalSource("https://spec.example.com/", {
      lookup: publicLookup,
      fetcher,
    });

    expect(snapshot.content_type).toBe("text/html");
    expect(snapshot.title).toBe("Spec");
    expect(snapshot.text).toBe(`${PARAGRAPH}\n${PARAGRAPH}`);
  });

  it("decodes a legacy charset from the header or the document itself", async () => {
    const body = (prefix: string) =>
      Buffer.concat([
        Buffer.from(`${prefix}<p>`),
        Buffer.from([0x93]),
        Buffer.from("quoted"),
        Buffer.from([0x94]),
        Buffer.from(" caf"),
        Buffer.from([0xe9]),
        Buffer.from(` ${PARAGRAPH} ${PARAGRAPH}</p>`),
      ]);

    const fromHeader = await fetchJournalSource("https://a.example.com/", {
      lookup: publicLookup,
      fetcher: serving(ok(body(""), "text/html; charset=windows-1252")),
    });
    const fromMeta = await fetchJournalSource("https://b.example.com/", {
      lookup: publicLookup,
      fetcher: serving(
        ok(body('<meta charset="windows-1252">'), "text/html")
      ),
    });

    expect(fromHeader.text.startsWith("“quoted” café ")).toBe(
      true
    );
    expect(fromMeta.text).toBe(fromHeader.text);
  });

  it("normalises the requested URL and follows a public redirect", async () => {
    const fetcher = serving(
      new Response(null, { status: 301, headers: { location: "/moved" } }),
      ok(`${PARAGRAPH}\n${PARAGRAPH}`, "text/plain")
    );

    const snapshot = await fetchJournalSource(
      "HTTPS://Source.Example.com/start here",
      { lookup: publicLookup, fetcher }
    );

    expect(snapshot.url).toBe("https://source.example.com/start%20here");
    expect(snapshot.final_url).toBe("https://source.example.com/moved");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

describe("fetchJournalSource — plain text and PDF", () => {
  it("snapshots plain text as-is after normalisation", async () => {
    const body = `  ${PARAGRAPH}\r\n\r\n\r\n\tIndented\t\tline   here  \r\n${PARAGRAPH}`;
    const snapshot = await fetchJournalSource(
      "https://www.data.example.org/notes.txt",
      {
        lookup: publicLookup,
        fetcher: serving(ok(body, "text/plain; charset=utf-8")),
      }
    );

    expect(snapshot).toMatchObject({
      content_type: "text/plain",
      title: null,
      site_name: "data.example.org",
      published_hint: null,
      modified_hint: null,
      sha256: sha256(body),
      truncated: false,
    });
    expect(snapshot.text).toBe(
      `${PARAGRAPH}\n\nIndented line here\n${PARAGRAPH}`
    );
  });

  it("extracts the text layer and title of a real two-page PDF", async () => {
    const pdf = await buildPdf(
      [
        [
          "Field report page one: the crew logged 42 site visits in August.",
          "Every visit was invoiced within two business days of completion.",
          "Owners reported fewer missed follow-ups than the prior quarter.",
        ],
        [
          "Field report page two: average job margin rose to 31 percent.",
          "Material returns were recorded against the originating project.",
          "No invoice in the sample went out more than a week after close.",
        ],
      ],
      "Quarterly field report"
    );

    const snapshot = await fetchJournalSource(
      "https://reports.example.com/q3.pdf",
      {
        lookup: publicLookup,
        fetcher: serving(ok(pdf, "application/pdf")),
      }
    );

    expect(snapshot).toMatchObject({
      content_type: "application/pdf",
      title: "Quarterly field report",
      site_name: "reports.example.com",
      bytes: pdf.byteLength,
      sha256: sha256(pdf),
      truncated: false,
    });
    const pageOne = snapshot.text.indexOf(
      "Field report page one: the crew logged 42 site visits in August."
    );
    const pageTwo = snapshot.text.indexOf(
      "Field report page two: average job margin rose to 31 percent."
    );
    expect(pageOne).toBeGreaterThanOrEqual(0);
    expect(pageTwo).toBeGreaterThan(pageOne);
    expect(snapshot.text).toContain(
      "Every visit was invoiced within two business days of completion."
    );
    expect(snapshot.text).toContain(
      "No invoice in the sample went out more than a week after close."
    );
  });

  it("reads at most 60 PDF pages and marks the snapshot truncated", async () => {
    const pages = Array.from({ length: 61 }, (_, index) => [
      `Marker page ${String(index + 1).padStart(3, "0")} of the long annual report.`,
    ]);
    const pdf = await buildPdf(pages);

    const snapshot = await fetchJournalSource(
      "https://reports.example.com/annual.pdf",
      {
        lookup: publicLookup,
        fetcher: serving(ok(pdf, "application/pdf")),
      }
    );

    expect(snapshot.text).toContain("Marker page 060");
    expect(snapshot.text).not.toContain("Marker page 061");
    expect(snapshot.truncated).toBe(true);
    expect(snapshot.title).toBeNull();
  });

  it("maps a document pdf.js cannot parse to SOURCE_UNREADABLE", async () => {
    const garbage = Buffer.from("this is not a portable document at all");

    await expect(extractPdfSource(garbage)).rejects.toMatchObject({
      code: "SOURCE_UNREADABLE",
    });
    await expect(
      fetchJournalSource("https://reports.example.com/broken.pdf", {
        lookup: publicLookup,
        fetcher: serving(ok(garbage, "application/pdf")),
      })
    ).rejects.toMatchObject({ code: "SOURCE_UNREADABLE" });
  });
});

describe("fetchJournalSource — guards", () => {
  it("rejects a redirect to a private IP before following it", async () => {
    const fetcher = serving(
      new Response(null, {
        status: 302,
        headers: { location: "https://10.0.0.8/internal" },
      })
    );

    const error = await rejection(
      fetchJournalSource("https://news.example.com/a", {
        lookup: publicLookup,
        fetcher,
      })
    );

    expect(error).toBeInstanceOf(JournalSourceError);
    expect(error).toMatchObject({ code: "SOURCE_PRIVATE_ADDRESS" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rejects a hostname that resolves to a private address", async () => {
    const fetcher = vi.fn();

    await expect(
      fetchJournalSource("https://intranet.example.com/a", {
        lookup: async () => [{ address: "192.168.1.10", family: 4 }],
        fetcher,
      })
    ).rejects.toMatchObject({ code: "SOURCE_PRIVATE_ADDRESS" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    "http://news.example.com/a",
    "https://user:secret@news.example.com/a",
    "https://news.example.com:8443/a",
    "not a url",
  ])("rejects %s as SOURCE_URL_INVALID", async (url) => {
    const fetcher = vi.fn();

    await expect(
      fetchJournalSource(url, { lookup: publicLookup, fetcher })
    ).rejects.toMatchObject({ code: "SOURCE_URL_INVALID" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("maps DNS failure and request timeout", async () => {
    await expect(
      fetchJournalSource("https://gone.example.com/a", {
        lookup: async () => {
          throw new Error("ENOTFOUND");
        },
        fetcher: vi.fn(),
      })
    ).rejects.toMatchObject({ code: "SOURCE_DNS_FAILED" });
    await expect(
      fetchJournalSource("https://slow.example.com/a", {
        lookup: publicLookup,
        fetcher: vi
          .fn()
          .mockRejectedValue(new DOMException("timed out", "TimeoutError")),
      })
    ).rejects.toMatchObject({ code: "SOURCE_TIMEOUT" });
  });

  it("maps a 404 to SOURCE_FETCH_FAILED with the status", async () => {
    const error = await rejection(
      fetchJournalSource("https://news.example.com/missing", {
        lookup: publicLookup,
        fetcher: serving(
          new Response("Not found", {
            status: 404,
            headers: { "content-type": "text/html" },
          })
        ),
      })
    );

    expect(error).toBeInstanceOf(JournalSourceError);
    expect(error).toMatchObject({ code: "SOURCE_FETCH_FAILED", status: 404 });
  });

  it("maps a body that fails mid-stream to SOURCE_FETCH_FAILED", async () => {
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error("socket reset"));
      },
    });

    await expect(
      fetchJournalSource("https://news.example.com/a", {
        lookup: publicLookup,
        fetcher: serving(ok(body, "text/html")),
      })
    ).rejects.toMatchObject({ code: "SOURCE_FETCH_FAILED" });
  });

  it("rejects a body declared over 8 MB before reading it", async () => {
    await expect(
      fetchJournalSource("https://news.example.com/huge", {
        lookup: publicLookup,
        fetcher: serving(
          ok("small", "text/html", {
            "content-length": String(9 * 1024 * 1024),
          })
        ),
      })
    ).rejects.toMatchObject({ code: "SOURCE_TOO_LARGE" });
  });

  it("stops a streamed body as soon as it crosses 8 MB", async () => {
    let pulls = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(new Uint8Array(1024 * 1024));
        if (pulls === 20) controller.close();
      },
      cancel() {
        cancelled = true;
      },
    });

    await expect(
      fetchJournalSource("https://news.example.com/stream", {
        lookup: publicLookup,
        fetcher: serving(ok(body, "text/plain")),
      })
    ).rejects.toMatchObject({ code: "SOURCE_TOO_LARGE" });
    expect(pulls).toBeLessThan(20);
    expect(cancelled).toBe(true);
  });

  it("rejects an image as SOURCE_UNSUPPORTED_TYPE", async () => {
    await expect(
      fetchJournalSource("https://cdn.example.com/photo.png", {
        lookup: publicLookup,
        fetcher: serving(ok(new Uint8Array([0x89, 0x50]), "image/png")),
      })
    ).rejects.toMatchObject({ code: "SOURCE_UNSUPPORTED_TYPE" });
  });

  it("rejects a page with under 200 characters of readable text", async () => {
    await expect(
      fetchJournalSource("https://news.example.com/stub", {
        lookup: publicLookup,
        fetcher: serving(
          ok(
            `<html><body><nav>${PARAGRAPH} ${PARAGRAPH}</nav><p>Coming soon.</p></body></html>`,
            "text/html"
          )
        ),
      })
    ).rejects.toMatchObject({ code: "SOURCE_EMPTY" });
  });

  it("cuts text at 150,000 characters and marks it truncated", async () => {
    const body = "word ".repeat(40_000);

    const snapshot = await fetchJournalSource(
      "https://data.example.com/long.txt",
      {
        lookup: publicLookup,
        fetcher: serving(ok(body, "text/plain")),
      }
    );

    expect(snapshot.text).toHaveLength(150_000);
    expect(snapshot.text).toBe(normaliseSourceText(body).slice(0, 150_000));
    expect(snapshot.truncated).toBe(true);
    expect(snapshot.bytes).toBe(200_000);
    expect(snapshot.sha256).toBe(sha256(body));
  });
});

describe("extractHtmlSource", () => {
  it.each([
    ["<p>a</p><p>b</p>", "a\nb"],
    ["<div>a</div>\n   <div>b</div>", "a\nb"],
    ["<table><tr><td>a</td><td>b</td></tr></table>", "a\nb"],
    ["a<br>b", "a\nb"],
    ["a<br><br>b", "a\n\nb"],
    ["<p>in<em>line</em>   text</p>", "inline text"],
    ["<h2>Heading</h2>Loose text<blockquote>Quote</blockquote>", "Heading\nLoose text\nQuote"],
    ["<pre>line one\n  indented</pre><p>after</p>", "line one\nindented\nafter"],
    ["<p>Tom &amp; Jerry&rsquo;s &lt;shop&gt;</p>", "Tom & Jerry’s <shop>"],
  ])("reads %j as %j", (html, text) => {
    expect(extractHtmlSource(html, "https://example.com/").text).toBe(text);
  });

  it("falls back from og:title to <title> to the first h1", () => {
    expect(
      extractHtmlSource(
        "<title>  Doc \n  title </title><h1>Heading</h1>",
        "https://example.com/"
      ).title
    ).toBe("Doc title");
    expect(
      extractHtmlSource(
        "<h1>Only <em>heading</em></h1><p>Body</p>",
        "https://example.com/"
      ).title
    ).toBe("Only heading");
    expect(
      extractHtmlSource(
        `<meta property="og:title" content="${"x".repeat(400)}">`,
        "https://example.com/"
      ).title
    ).toHaveLength(300);
  });

  it("falls back to the hostname without www for the site name", () => {
    const extracted = extractHtmlSource(
      "<p>Body</p>",
      "https://www.Example.com/post"
    );

    expect(extracted.site_name).toBe("example.com");
    expect(extracted.title).toBeNull();
    expect(extracted.published_hint).toBeNull();
    expect(extracted.modified_hint).toBeNull();
  });

  it("skips unparseable dates and follows the published-date precedence", () => {
    const fromMetaDate = extractHtmlSource(
      '<meta property="article:published_time" content="soon"><meta name="date" content="2026-03-05">',
      "https://example.com/"
    );
    const fromDcDate = extractHtmlSource(
      '<meta name="DC.date" content="5 March 2026">',
      "https://example.com/"
    );
    const fromItemprop = extractHtmlSource(
      '<meta itemprop="datePublished" content="Tue, 03 Mar 2026 10:00:00 GMT">',
      "https://example.com/"
    );
    const fromTime = extractHtmlSource(
      '<footer><time datetime="2001-01-01">Old</time></footer><article><time datetime="2026-07-01T08:00:00">July 1</time></article>',
      "https://example.com/"
    );
    const metaBeatsJsonLd = extractHtmlSource(
      '<meta property="article:published_time" content="2026-02-01T00:00:00+00:00"><script type="application/ld+json">[{"@type":"BlogPosting","datePublished":"2020-01-01"}]</script>',
      "https://example.com/"
    );

    expect(fromMetaDate.published_hint).toBe("2026-03-05T00:00:00.000Z");
    expect(fromDcDate.published_hint).toBe("2026-03-05T00:00:00.000Z");
    expect(fromItemprop.published_hint).toBe("2026-03-03T10:00:00.000Z");
    expect(fromTime.published_hint).toBe("2026-07-01T08:00:00.000Z");
    expect(metaBeatsJsonLd.published_hint).toBe("2026-02-01T00:00:00.000Z");
  });

  it("prefers article:modified_time over JSON-LD dateModified", () => {
    const extracted = extractHtmlSource(
      '<meta property="article:modified_time" content="2026-04-02T09:00:00Z"><script type="application/ld+json">{"@type":"Article","dateModified":"2026-01-01"}</script>',
      "https://example.com/"
    );
    const fallback = extractHtmlSource(
      '<script type="application/ld+json">{"@type":"Article","dateModified":"2026-01-01"}</script>',
      "https://example.com/"
    );

    expect(extracted.modified_hint).toBe("2026-04-02T09:00:00.000Z");
    expect(fallback.modified_hint).toBe("2026-01-01T00:00:00.000Z");
  });

  it("rejects impossible calendar dates", () => {
    expect(
      extractHtmlSource(
        '<meta name="date" content="2026-02-30">',
        "https://example.com/"
      ).published_hint
    ).toBeNull();
  });
});

describe("normaliseSourceText", () => {
  it("applies NFC, space folding, line trimming, and blank-line collapse", () => {
    expect(
      normaliseSourceText(
        "  Cafe\u0301\u00a0du\u2007jour\u202fnow \t\t here  \r\n\r\n\r\n\r\nnext  line \n"
      )
    ).toBe("Caf\u00e9 du jour now here\n\nnext line");
  });

  it("is idempotent", () => {
    const once = normaliseSourceText(` a \n\n\n\n b\t\tc `);
    expect(normaliseSourceText(once)).toBe(once);
  });
});
