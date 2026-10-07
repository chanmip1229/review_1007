import { NextRequest, NextResponse } from "next/server";

export interface ReviewInputItem {
  review_no: number;
  written_on: string;
  rating: number;
  review_text: string;
}

export interface AnalyzedReviewItem {
  review_no: number;
  sentiment: "긍정" | "부정" | "중립" | "광고";
  categories: string[];
  improvement_request: string;
  is_safety_issue: boolean;
}

const ALLOWED_SENTIMENTS = ["긍정", "부정", "중립", "광고"] as const;
const ALLOWED_CATEGORIES = [
  "배터리",
  "흡입력",
  "소음",
  "무게·사용감",
  "디자인",
  "관리·청소",
  "구성품",
  "품질·불량",
  "배송",
  "포장",
  "고객센터",
  "가격",
  "설명서",
  "기타",
] as const;

const SYSTEM_PROMPT = `당신은 생활가전 쇼핑몰 「하루살림」의 무선 청소기 「클린핏 미니」 리뷰를 정확하고 일관된 기준으로 분류하는 전문 분석가입니다.
입력된 모든 리뷰를 빠짐없이 한 건씩 아래 [기준표]에 따라 엄격히 분류하여 JSON으로 반환하세요.

[기준표]
1. [감성] (sentiment): 반드시 "긍정", "부정", "중립", "광고" 중 하나로만 분류합니다.
   - 별점(rating)이 아니라 리뷰 내용(review_text)의 실제 뜻으로 판단합니다. 절대 별점으로 대신 채우지 마세요.
   - 반어법(말은 칭찬이지만 뜻은 불만인 경우. 예: "배송 정말 빠르네요^^ 주문하고 딱 12일 만에 왔어요", "소리 조용하네요~ 옆집에서 공사하는 줄ㅋㅋ", "10분 만에 꺼져서 청소할 시간이 줄었어요ㅎㅎ")은 반드시 "부정"으로 분류합니다.
   - 체험단·원고료·무상 제공·할인 링크(예: "[체험단]", "무상 제공", "[광고]", "원고료", "할인쿠폰 링크" 등)가 있으면 무조건 "광고"로 분류합니다.
   - 칭찬과 불만이 섞여 있으면 더 강한 쪽으로 분류하고(예: "별 다섯 개 드리는데요 배터리는 진짜 금방 닳아요. 이거 하나만 고쳐 주세요" → "부정", "색상이 사진이랑 조금 달라요. 그래도 만족" → "긍정", "배송은 늦었지만 제품은 괜찮네요" → 비슷하면 "중립"), 강도가 비슷하거나 무난하다는 평가면 "중립"으로 분류합니다.

2. [유형] (categories): 다음 14개 유형 중에서만 선택하여 배열로 적습니다.
   Allowed: ["배터리", "흡입력", "소음", "무게·사용감", "디자인", "관리·청소", "구성품", "품질·불량", "배송", "포장", "고객센터", "가격", "설명서", "기타"]
   - 한 리뷰에 주제가 둘 이상이면 해당하는 유형을 모두 적습니다(복수 선택).
   - "광고" 리뷰이더라도 언급된 주제나 "기타"를 넣을 수 있습니다.

3. [따로 뽑기]
   - 개선 요청 (improvement_request): "~면 좋겠어요", "~해 주세요", "~없나요?", "~아쉽네요", "어댑터/거치대/표시등/배터리 교체 등 구체적 개선 희망 사항"이 있으면 핵심 내용을 짧고 명확한 문구로 적고, 없으면 빈 문자열("")로 둡니다.
   - 안전 이슈 (is_safety_issue): 뜨거움(발열)·냄새(타는 냄새 등)·연기·감전 관련 언급이 조금이라도 있으면 무조건 true로 표시하고, 없으면 false로 표시합니다.`;

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    reviews: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          review_no: { type: "INTEGER" },
          sentiment: {
            type: "STRING",
            enum: ["긍정", "부정", "중립", "광고"],
          },
          categories: {
            type: "ARRAY",
            items: {
              type: "STRING",
              enum: [
                "배터리",
                "흡입력",
                "소음",
                "무게·사용감",
                "디자인",
                "관리·청소",
                "구성품",
                "품질·불량",
                "배송",
                "포장",
                "고객센터",
                "가격",
                "설명서",
                "기타",
              ],
            },
          },
          improvement_request: { type: "STRING" },
          is_safety_issue: { type: "BOOLEAN" },
        },
        required: [
          "review_no",
          "sentiment",
          "categories",
          "improvement_request",
          "is_safety_issue",
        ],
      },
    },
  },
  required: ["reviews"],
};

async function callGeminiModel(
  model: string,
  apiKey: string,
  reviewsPayload: string
): Promise<{ status: number; text: string | null }> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: SYSTEM_PROMPT }],
      },
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `다음 리뷰 목록 전체를 [기준표]에 따라 빠짐없이 분석해 주세요:\n\n${reviewsPayload}`,
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
      },
    }),
  });

  if (!response.ok) {
    return { status: response.status, text: null };
  }

  const data = await response.json();
  const text =
    data?.candidates?.[0]?.content?.parts
      ?.map((p: { text?: string }) => p.text || "")
      .join("") || null;

  return { status: response.status, text };
}

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "불러오지 못했습니다" },
        { status: 500 }
      );
    }

    const body = await req.json();
    const reviews: ReviewInputItem[] = body?.reviews;

    if (!Array.isArray(reviews) || reviews.length === 0) {
      return NextResponse.json(
        { error: "불러오지 못했습니다" },
        { status: 400 }
      );
    }

    // Prepare single-request payload with review_no and review_text
    const reviewsPayload = JSON.stringify(
      reviews.map((r) => ({
        review_no: r.review_no,
        review_text: r.review_text,
      }))
    );

    const primaryModel = "gemini-3.8-flash";
    const fallbackModel = "gemini-3.5-flash-lite";

    let usedModel = primaryModel;
    let result = await callGeminiModel(primaryModel, apiKey, reviewsPayload);

    // If 503 (Service Unavailable / high load), retry exactly once with gemini-3.5-flash-lite
    if (result.status === 503) {
      usedModel = fallbackModel;
      result = await callGeminiModel(fallbackModel, apiKey, reviewsPayload);
    }

    if (!result.text) {
      return NextResponse.json(
        { error: "불러오지 못했습니다" },
        { status: 502 }
      );
    }

    const parsed = JSON.parse(result.text);
    const analyzedList: AnalyzedReviewItem[] = parsed?.reviews;

    if (!Array.isArray(analyzedList) || analyzedList.length === 0) {
      return NextResponse.json(
        { error: "불러오지 못했습니다" },
        { status: 502 }
      );
    }

    // Map by review_no and validate that every input review received a valid AI classification
    // Never fabricate or fallback to star rating if AI answer is missing
    const analyzedMap = new Map<number, AnalyzedReviewItem>();
    for (const item of analyzedList) {
      if (
        typeof item.review_no === "number" &&
        ALLOWED_SENTIMENTS.includes(item.sentiment)
      ) {
        const validCategories = Array.isArray(item.categories)
          ? item.categories.filter((c) =>
              ALLOWED_CATEGORIES.includes(
                c as (typeof ALLOWED_CATEGORIES)[number]
              )
            )
          : [];
        analyzedMap.set(item.review_no, {
          review_no: item.review_no,
          sentiment: item.sentiment,
          categories: validCategories.length > 0 ? validCategories : ["기타"],
          improvement_request:
            typeof item.improvement_request === "string"
              ? item.improvement_request.trim()
              : "",
          is_safety_issue: Boolean(item.is_safety_issue),
        });
      }
    }

    if (analyzedMap.size === 0) {
      return NextResponse.json(
        { error: "불러오지 못했습니다" },
        { status: 502 }
      );
    }

    const mergedResults = [];
    for (const r of reviews) {
      const aiItem = analyzedMap.get(r.review_no);
      if (!aiItem) {
        // Do not fill with star rating or fabricate data
        return NextResponse.json(
          { error: "불러오지 못했습니다" },
          { status: 502 }
        );
      }
      mergedResults.push({
        review_no: r.review_no,
        written_on: r.written_on,
        rating: r.rating,
        review_text: r.review_text,
        sentiment: aiItem.sentiment,
        categories: aiItem.categories.join(", "),
        improvement_request: aiItem.improvement_request,
        is_safety_issue: aiItem.is_safety_issue,
        model_used: usedModel,
      });
    }

    return NextResponse.json({
      model_used: usedModel,
      results: mergedResults,
    });
  } catch {
    return NextResponse.json(
      { error: "불러오지 못했습니다" },
      { status: 500 }
    );
  }
}
