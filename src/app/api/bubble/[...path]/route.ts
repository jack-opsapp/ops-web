/**
 * OPS Web - Bubble API Proxy Route
 *
 * Server-side proxy that forwards requests to Bubble.io with the API token
 * set explicitly in the Authorization header. This eliminates any header
 * forwarding issues with Next.js rewrites and keeps the API token server-side.
 *
 * Browser requests → /api/bubble/* → this route → Bubble API
 */

import { NextRequest, NextResponse } from "next/server";

const BUBBLE_BASE =
  process.env.NEXT_PUBLIC_BUBBLE_API_URL ||
  "https://opsapp.co/version-test/api/1.1";
const BUBBLE_TOKEN = process.env.NEXT_PUBLIC_BUBBLE_API_TOKEN || "";

async function proxyToBubble(
  req: NextRequest,
  path: string,
  method: string
): Promise<NextResponse> {
  const url = `${BUBBLE_BASE}/${path}${req.nextUrl.search}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (BUBBLE_TOKEN) {
    headers["Authorization"] = `Bearer ${BUBBLE_TOKEN}`;
  }

  const fetchOptions: RequestInit = {
    method,
    headers,
  };

  // Include body for POST, PATCH, PUT
  if (method !== "GET" && method !== "DELETE") {
    try {
      const body = await req.json();
      fetchOptions.body = JSON.stringify(body);
    } catch {
      // No body - that's fine for some requests
    }
  }

  try {
    const resp = await fetch(url, fetchOptions);
    const contentType = resp.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
      const data = await resp.json();
      return NextResponse.json(data, { status: resp.status });
    }

    // Non-JSON response (rare for Bubble API)
    const text = await resp.text();
    return new NextResponse(text, {
      status: resp.status,
      headers: { "Content-Type": contentType },
    });
  } catch (error) {
    console.error("[BubbleProxy] Error:", method, url, error);
    return NextResponse.json(
      { error: "Failed to proxy request to Bubble API" },
      { status: 502 }
    );
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  return proxyToBubble(req, path.join("/"), "GET");
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  return proxyToBubble(req, path.join("/"), "POST");
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  return proxyToBubble(req, path.join("/"), "PATCH");
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  return proxyToBubble(req, path.join("/"), "DELETE");
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  return proxyToBubble(req, path.join("/"), "PUT");
}
