import { NextResponse } from "next/server";

export interface SafetyStatResult {
  totalVacuumCases: number;
  topReasons: {
    rank: number;
    reason: string;
    count: number;
  }[];
  cachedAt: string;
}

// In-memory 24h cache fallback in addition to Next.js fetch revalidate: 86400
let memoryCache: { data: SafetyStatResult; expiresAt: number } | null = null;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const ONE_DAY_SECONDS = 86400;

function extractItems(payload: unknown): Record<string, unknown>[] | null {
  if (!payload || typeof payload !== "object") return null;
  const obj = payload as Record<string, unknown>;

  // Direct array check
  if (Array.isArray(obj.data)) return obj.data as Record<string, unknown>[];
  if (Array.isArray(obj.items)) return obj.items as Record<string, unknown>[];
  if (Array.isArray(obj.list)) return obj.list as Record<string, unknown>[];
  if (Array.isArray(obj.result)) return obj.result as Record<string, unknown>[];

  // Nested response.body.items...
  const response = obj.response as Record<string, unknown> | undefined;
  const body = (response?.body ?? obj.body) as
    | Record<string, unknown>
    | undefined;
  if (body && typeof body === "object") {
    if (Array.isArray(body.items)) return body.items as Record<string, unknown>[];
    if (Array.isArray(body.data)) return body.data as Record<string, unknown>[];
    if (Array.isArray(body.list)) return body.list as Record<string, unknown>[];
    const itemsObj = body.items as Record<string, unknown> | undefined;
    if (itemsObj && Array.isArray(itemsObj.item)) {
      return itemsObj.item as Record<string, unknown>[];
    }
  }

  return null;
}

async function fetchSafetyPage(
  serviceKey: string,
  pageNo: number
): Promise<Record<string, unknown>[] | null> {
  const baseUrl = "https://apis.data.go.kr/B551919/open-api/harm/reception";
  // Handle both raw and pre-encoded service keys cleanly
  const encodedKey = serviceKey.includes("%")
    ? serviceKey
    : encodeURIComponent(serviceKey);

  const url = `${baseUrl}?serviceKey=${encodedKey}&pageNo=${pageNo}&numOfRows=1000&apiFormat=json`;

  const res = await fetch(url, {
    next: { revalidate: ONE_DAY_SECONDS },
  });

  if (!res.ok) {
    return null;
  }

  const json = await res.json();
  return extractItems(json);
}

export async function GET() {
  try {
    const now = Date.now();
    if (memoryCache && memoryCache.expiresAt > now) {
      return NextResponse.json(memoryCache.data);
    }

    const serviceKey = process.env.CONSUMER_SAFETY_API_KEY;
    if (!serviceKey) {
      return NextResponse.json(
        { error: "불러오지 못했습니다" },
        { status: 500 }
      );
    }

    // Fetch 1,000 rows per page for pages 1, 2, and 3 only
    const pages = await Promise.all([
      fetchSafetyPage(serviceKey, 1),
      fetchSafetyPage(serviceKey, 2),
      fetchSafetyPage(serviceKey, 3),
    ]);

    if (pages.some((p) => p === null)) {
      return NextResponse.json(
        { error: "불러오지 못했습니다" },
        { status: 502 }
      );
    }

    const allRows = [...(pages[0] || []), ...(pages[1] || []), ...(pages[2] || [])];
    if (allRows.length === 0) {
      return NextResponse.json(
        { error: "불러오지 못했습니다" },
        { status: 502 }
      );
    }

    // Filter only where itemMinor === "가정용 진공청소기"
    const vacuumRows = allRows.filter((row) => {
      const minor = String(row.itemMinor ?? "").trim();
      return minor === "가정용 진공청소기";
    });

    const reasonCounts = new Map<string, number>();
    for (const row of vacuumRows) {
      const reason = String(row.injuryReason ?? "").trim() || "미상";
      reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + 1);
    }

    const sortedReasons = Array.from(reasonCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([reason, count], index) => ({
        rank: index + 1,
        reason,
        count,
      }));

    const resultData: SafetyStatResult = {
      totalVacuumCases: vacuumRows.length,
      topReasons: sortedReasons,
      cachedAt: new Date(now).toISOString(),
    };

    memoryCache = {
      data: resultData,
      expiresAt: now + ONE_DAY_MS,
    };

    return NextResponse.json(resultData);
  } catch {
    return NextResponse.json(
      { error: "불러오지 못했습니다" },
      { status: 500 }
    );
  }
}
