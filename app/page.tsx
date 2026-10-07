"use client";

import React, { useEffect, useState, useMemo } from "react";
import { parseReviewCsv, ParsedReview } from "@/lib/csv";
import { supabase, ReviewAnalysisRow } from "@/lib/supabase";

interface SafetyData {
  totalVacuumCases: number;
  topReasons: { rank: number; reason: string; count: number }[];
  cachedAt: string;
}

interface HistoryDaySummary {
  analyzed_on: string;
  totalCount: number;
  nonAdCount: number;
  negativeCount: number;
  negativeRatio: string;
}

const ALL_CATEGORIES = [
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
];

function getTodayDateString(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export default function HomePage() {
  // File upload state
  const [selectedFileName, setSelectedFileName] = useState<string>("");
  const [parsedReviews, setParsedReviews] = useState<ParsedReview[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);

  // Analysis state
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [analyzedRows, setAnalyzedRows] = useState<ReviewAnalysisRow[]>([]);
  const [modelUsed, setModelUsed] = useState<string>("");
  const [saveMessage, setSaveMessage] = useState<string>("");

  // Consumer Safety API state
  const [safetyData, setSafetyData] = useState<SafetyData | null>(null);
  const [safetyLoading, setSafetyLoading] = useState<boolean>(true);
  const [safetyError, setSafetyError] = useState<string | null>(null);

  // Supabase Past History state
  const [historySummaries, setHistorySummaries] = useState<HistoryDaySummary[]>(
    []
  );
  const [historyLoading, setHistoryLoading] = useState<boolean>(true);
  const [historyError, setHistoryError] = useState<string | null>(null);

  // Manual 3-line conclusion ("우리가 고칠 것") - Never auto-filled
  const [conclusionLine1, setConclusionLine1] = useState<string>("");
  const [conclusionLine2, setConclusionLine2] = useState<string>("");
  const [conclusionLine3, setConclusionLine3] = useState<string>("");

  // Load Consumer Safety API on mount
  useEffect(() => {
    async function loadSafety() {
      setSafetyLoading(true);
      setSafetyError(null);
      try {
        const res = await fetch("/api/safety");
        if (!res.ok) {
          setSafetyError("불러오지 못했습니다");
          setSafetyLoading(false);
          return;
        }
        const data = await res.json();
        if (
          !data ||
          typeof data.totalVacuumCases !== "number" ||
          !Array.isArray(data.topReasons)
        ) {
          setSafetyError("불러오지 못했습니다");
        } else {
          setSafetyData(data);
        }
      } catch {
        setSafetyError("불러오지 못했습니다");
      } finally {
        setSafetyLoading(false);
      }
    }
    loadSafety();
  }, []);

  // Load past analysis history from Supabase
  const fetchHistory = async () => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      if (!supabase) {
        setHistoryError("불러오지 못했습니다");
        setHistoryLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from("review_analysis")
        .select("analyzed_on, sentiment")
        .order("analyzed_on", { ascending: false });

      if (error || !data) {
        setHistoryError("불러오지 못했습니다");
        setHistoryLoading(false);
        return;
      }

      // Group by analyzed_on (건수 · 부정 비율)
      const grouped = new Map<
        string,
        { total: number; nonAd: number; negative: number }
      >();

      for (const row of data) {
        const dateKey = String(row.analyzed_on || "날짜 미상");
        const entry = grouped.get(dateKey) || {
          total: 0,
          nonAd: 0,
          negative: 0,
        };
        entry.total += 1;
        if (row.sentiment !== "광고") {
          entry.nonAd += 1;
          if (row.sentiment === "부정") {
            entry.negative += 1;
          }
        }
        grouped.set(dateKey, entry);
      }

      const summaries: HistoryDaySummary[] = Array.from(grouped.entries())
        .sort((a, b) => b[0].localeCompare(a[0]))
        .map(([analyzed_on, counts]) => {
          const ratio =
            counts.nonAd > 0
              ? `${((counts.negative / counts.nonAd) * 100).toFixed(1)}%`
              : "0.0%";
          return {
            analyzed_on,
            totalCount: counts.total,
            nonAdCount: counts.nonAd,
            negativeCount: counts.negative,
            negativeRatio: ratio,
          };
        });

      setHistorySummaries(summaries);
    } catch {
      setHistoryError("불러오지 못했습니다");
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, []);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setFileError(null);
    setAnalysisError(null);
    setSaveMessage("");
    const file = e.target.files?.[0];
    if (!file) {
      setSelectedFileName("");
      setParsedReviews([]);
      return;
    }

    setSelectedFileName(file.name);
    try {
      const text = await file.text();
      const rows = parseReviewCsv(text);
      if (rows.length === 0) {
        setFileError("불러오지 못했습니다");
        setParsedReviews([]);
      } else {
        setParsedReviews(rows);
      }
    } catch {
      setFileError("불러오지 못했습니다");
      setParsedReviews([]);
    }
  };

  const handleAnalyze = async () => {
    if (parsedReviews.length === 0) {
      setAnalysisError("불러오지 못했습니다");
      return;
    }

    setIsAnalyzing(true);
    setAnalysisError(null);
    setSaveMessage("");

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviews: parsedReviews }),
      });

      if (!response.ok) {
        setAnalysisError("불러오지 못했습니다");
        setIsAnalyzing(false);
        return;
      }

      const data = await response.json();
      if (
        !data ||
        !Array.isArray(data.results) ||
        data.results.length === 0 ||
        !data.model_used
      ) {
        setAnalysisError("불러오지 못했습니다");
        setIsAnalyzing(false);
        return;
      }

      const today = getTodayDateString();
      const rowsToSave: ReviewAnalysisRow[] = data.results.map(
        (item: ReviewAnalysisRow) => ({
          analyzed_on: today,
          review_no: item.review_no,
          written_on: item.written_on,
          rating: item.rating,
          review_text: item.review_text,
          sentiment: item.sentiment,
          categories: item.categories,
          improvement_request: item.improvement_request || "",
          is_safety_issue: Boolean(item.is_safety_issue),
          model_used: data.model_used,
        })
      );

      setAnalyzedRows(rowsToSave);
      setModelUsed(data.model_used);

      // Save each review row to Supabase review_analysis table
      if (!supabase) {
        setAnalysisError("불러오지 못했습니다");
      } else {
        const { error: insertError } = await supabase
          .from("review_analysis")
          .insert(rowsToSave);

        if (insertError) {
          setAnalysisError("불러오지 못했습니다");
        } else {
          setSaveMessage(
            `Supabase review_analysis 테이블에 ${rowsToSave.length}건 저장 완료 (${today})`
          );
          await fetchHistory();
        }
      }
    } catch {
      setAnalysisError("불러오지 못했습니다");
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Aggregated metrics (excluding "광고" from sentiment statistics as required by criteria)
  const summaryStats = useMemo(() => {
    const total = analyzedRows.length;
    const adRows = analyzedRows.filter((r) => r.sentiment === "광고");
    const nonAdRows = analyzedRows.filter((r) => r.sentiment !== "광고");
    const nonAdTotal = nonAdRows.length;

    const positiveCount = nonAdRows.filter(
      (r) => r.sentiment === "긍정"
    ).length;
    const negativeCount = nonAdRows.filter(
      (r) => r.sentiment === "부정"
    ).length;
    const neutralCount = nonAdRows.filter((r) => r.sentiment === "중립").length;

    const pct = (count: number) =>
      nonAdTotal > 0 ? `${((count / nonAdTotal) * 100).toFixed(1)}%` : "0.0%";

    // Complaint category counts (from 부정 or all non-ad reviews; show both negative complaint count and overall mention count)
    const categoryStats = ALL_CATEGORIES.map((cat) => {
      let complaintCount = 0;
      let totalMentionCount = 0;
      for (const row of nonAdRows) {
        const cats = row.categories
          .split(",")
          .map((c) => c.trim())
          .filter(Boolean);
        if (cats.includes(cat)) {
          totalMentionCount += 1;
          if (row.sentiment === "부정") {
            complaintCount += 1;
          }
        }
      }
      return {
        category: cat,
        complaintCount,
        totalMentionCount,
      };
    }).sort(
      (a, b) =>
        b.complaintCount - a.complaintCount ||
        b.totalMentionCount - a.totalMentionCount
    );

    const safetyIssues = analyzedRows.filter((r) => r.is_safety_issue);
    const improvementRequests = nonAdRows.filter(
      (r) => r.improvement_request && r.improvement_request.trim().length > 0
    );

    return {
      total,
      adCount: adRows.length,
      nonAdTotal,
      positiveCount,
      positivePct: pct(positiveCount),
      negativeCount,
      negativePct: pct(negativeCount),
      neutralCount,
      neutralPct: pct(neutralCount),
      categoryStats,
      safetyIssues,
      improvementRequests,
    };
  }, [analyzedRows]);

  return (
    <main className="container">
      <header className="header">
        <div>
          <h1>하루살림 「클린핏 미니」 리뷰 분석기</h1>
          <p className="subtitle">
            월간 리뷰 CSV 자동 분류 · 한국소비자원 청소기 사고 현황 · 분석 이력
            누적 대시보드
          </p>
        </div>
        {modelUsed && (
          <div className="badge-model">
            <span>실제 응답 모델:</span>
            <strong>{modelUsed}</strong>
          </div>
        )}
      </header>

      {/* 1. CSV 업로드 및 분석 실행 */}
      <section className="card">
        <h2>
          <span>1. 리뷰 CSV 파일 업로드 및 분석</span>
          {parsedReviews.length > 0 && (
            <span className="muted-note">
              선택된 파일: {selectedFileName} ({parsedReviews.length}건 읽음)
            </span>
          )}
        </h2>
        <div className="upload-bar">
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={handleFileChange}
            className="file-input"
            aria-label="리뷰 CSV 파일 선택"
          />
          <button
            type="button"
            className="btn-primary"
            onClick={handleAnalyze}
            disabled={isAnalyzing || parsedReviews.length === 0}
          >
            {isAnalyzing
              ? "Gemini AI로 전체 리뷰 일괄 분석 중..."
              : `리뷰 일괄 분석 및 저장 (${parsedReviews.length}건)`}
          </button>
        </div>
        {fileError && (
          <div className="error-box" style={{ marginTop: "0.85rem" }}>
            {fileError}
          </div>
        )}
        {analysisError && (
          <div className="error-box" style={{ marginTop: "0.85rem" }}>
            {analysisError}
          </div>
        )}
        {saveMessage && (
          <p
            className="muted-note"
            style={{ marginTop: "0.75rem", color: "#166534", fontWeight: 600 }}
          >
            ✓ {saveMessage} (응답 모델: {modelUsed})
          </p>
        )}
      </section>

      {/* 2. 분석 결과 요약 표 & 한국소비자원 청소기 사고 현황 (나란히 배치) */}
      <div className="grid-two">
        {/* 왼쪽: 리뷰 분석 결과 영역 */}
        <div className="section-stack">
          <section className="card">
            <h2>
              <span>2. 감성 분류 요약 (광고 제외 집계)</span>
              {modelUsed && (
                <span className="badge-model">응답 모델: {modelUsed}</span>
              )}
            </h2>
            {analysisError ? (
              <div className="error-box">불러오지 못했습니다</div>
            ) : analyzedRows.length === 0 ? (
              <p className="muted-note">
                CSV 파일을 업로드하고 [리뷰 일괄 분석 및 저장]을 실행하면 긍정/부정
                및 불만 유형별 건수가 표로 표시됩니다.
              </p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>구분</th>
                      <th>건수</th>
                      <th>비율 (광고 제외)</th>
                      <th>기준 설명</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>
                        <span className="tag tag-긍정">긍정</span>
                      </td>
                      <td>
                        <strong>{summaryStats.positiveCount}건</strong>
                      </td>
                      <td>{summaryStats.positivePct}</td>
                      <td className="muted-note">칭찬 우세 리뷰</td>
                    </tr>
                    <tr>
                      <td>
                        <span className="tag tag-부정">부정</span>
                      </td>
                      <td>
                        <strong>{summaryStats.negativeCount}건</strong>
                      </td>
                      <td>
                        <strong>{summaryStats.negativePct}</strong>
                      </td>
                      <td className="muted-note">
                        불만 우세 및 반어법(말은 칭찬, 뜻은 불만) 포함
                      </td>
                    </tr>
                    <tr>
                      <td>
                        <span className="tag tag-중립">중립</span>
                      </td>
                      <td>
                        <strong>{summaryStats.neutralCount}건</strong>
                      </td>
                      <td>{summaryStats.neutralPct}</td>
                      <td className="muted-note">칭찬·불만 강도 비슷 / 무난</td>
                    </tr>
                    <tr>
                      <td>
                        <strong>집계 합계 (광고 제외)</strong>
                      </td>
                      <td>
                        <strong>{summaryStats.nonAdTotal}건</strong>
                      </td>
                      <td>100.0%</td>
                      <td className="muted-note">
                        전체 {summaryStats.total}건 중 광고{" "}
                        {summaryStats.adCount}건 제외
                      </td>
                    </tr>
                    <tr>
                      <td>
                        <span className="tag tag-광고">광고 (집계 제외)</span>
                      </td>
                      <td>{summaryStats.adCount}건</td>
                      <td>-</td>
                      <td className="muted-note">
                        체험단 · 원고료 · 무상 제공 · 할인 링크
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* 불만 유형별 건수 표 */}
          {analyzedRows.length > 0 && !analysisError && (
            <section className="card">
              <h2>
                <span>3. 불만 유형별 건수 표 (14개 기준 유형)</span>
                <span className="muted-note">복수 유형 중복 집계 허용</span>
              </h2>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>순위</th>
                      <th>유형</th>
                      <th>부정(불만) 리뷰 건수</th>
                      <th>전체 언급 건수 (광고 제외)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summaryStats.categoryStats.map((item, idx) => (
                      <tr key={item.category}>
                        <td>{idx + 1}</td>
                        <td>
                          <strong>{item.category}</strong>
                        </td>
                        <td>
                          <strong
                            style={{
                              color:
                                item.complaintCount > 0 ? "#b91c1c" : "inherit",
                            }}
                          >
                            {item.complaintCount}건
                          </strong>
                        </td>
                        <td>{item.totalMentionCount}건</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* 안전 이슈 따로 뽑기 표 */}
          {analyzedRows.length > 0 && !analysisError && (
            <section className="card safety-alert-card">
              <h2>
                <span style={{ color: "#be123c" }}>
                  🚨 안전 이슈 감지 리뷰 ({summaryStats.safetyIssues.length}건)
                </span>
                <span className="muted-note">
                  기준: 뜨거움 · 냄새 · 연기 · 감전 무조건 표시
                </span>
              </h2>
              {summaryStats.safetyIssues.length === 0 ? (
                <p className="muted-note">감지된 안전 이슈 리뷰가 없습니다.</p>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>번호</th>
                        <th>작성일</th>
                        <th>별점</th>
                        <th>유형</th>
                        <th>리뷰 원문</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summaryStats.safetyIssues.map((row) => (
                        <tr key={row.review_no}>
                          <td>{row.review_no}</td>
                          <td>{row.written_on}</td>
                          <td>{row.rating}</td>
                          <td>{row.categories}</td>
                          <td>
                            <strong>{row.review_text}</strong>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {/* 개선 요청 따로 뽑기 표 */}
          {analyzedRows.length > 0 && !analysisError && (
            <section className="card">
              <h2>
                <span>
                  💡 고객 개선 요청 따로 뽑기 (
                  {summaryStats.improvementRequests.length}건)
                </span>
                <span className="muted-note">
                  &quot;~면 좋겠어요&quot;, &quot;~해 주세요&quot; 등
                </span>
              </h2>
              {summaryStats.improvementRequests.length === 0 ? (
                <p className="muted-note">추출된 개선 요청 사항이 없습니다.</p>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>번호</th>
                        <th>유형</th>
                        <th>추출된 개선 요청</th>
                        <th>리뷰 원문</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summaryStats.improvementRequests.map((row) => (
                        <tr key={row.review_no}>
                          <td>{row.review_no}</td>
                          <td>{row.categories}</td>
                          <td>
                            <strong>{row.improvement_request}</strong>
                          </td>
                          <td className="muted-note">{row.review_text}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
        </div>

        {/* 오른쪽: 한국소비자원 청소기 사고 현황 & 우리가 고칠 것 결론 3줄 */}
        <div className="section-stack">
          <section className="card">
            <h2>
              <span>🏛️ 한국소비자원 「가정용 진공청소기」 사고 현황</span>
            </h2>
            <p className="muted-note" style={{ marginBottom: "0.85rem" }}>
              공공데이터포털 소비자 위해 정보 API (최근 3,000건 중 품목소분류{" "}
              <strong>「가정용 진공청소기」</strong> 필터 · 24시간 캐시)
            </p>

            {safetyLoading ? (
              <p className="muted-note">
                한국소비자원 데이터를 불러오는 중입니다...
              </p>
            ) : safetyError || !safetyData ? (
              <div className="error-box">불러오지 못했습니다</div>
            ) : (
              <div>
                <div
                  style={{
                    background: "#f8fafc",
                    border: "1px solid #e2e8f0",
                    borderRadius: "8px",
                    padding: "0.9rem 1rem",
                    marginBottom: "1rem",
                  }}
                >
                  <span className="muted-note">
                    가정용 진공청소기 사고 접수 건수 (조회된 3,000건 중)
                  </span>
                  <div
                    style={{
                      fontSize: "1.5rem",
                      fontWeight: 800,
                      color: "#0f172a",
                      marginTop: "0.2rem",
                    }}
                  >
                    총 {safetyData.totalVacuumCases}건
                  </div>
                </div>

                <h3
                  style={{
                    fontSize: "0.95rem",
                    fontWeight: 700,
                    marginBottom: "0.5rem",
                  }}
                >
                  주요 위해원인 (injuryReason) 1~3위
                </h3>
                {safetyData.topReasons.length === 0 ? (
                  <p className="muted-note">
                    해당 범위 내 가정용 진공청소기 접수 건이 없습니다.
                  </p>
                ) : (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>순위</th>
                          <th>위해원인 (injuryReason)</th>
                          <th>건수</th>
                        </tr>
                      </thead>
                      <tbody>
                        {safetyData.topReasons.map((item) => (
                          <tr key={item.rank}>
                            <td>
                              <strong>{item.rank}위</strong>
                            </td>
                            <td>{item.reason}</td>
                            <td>
                              <strong>{item.count}건</strong>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* 우리가 고칠 것 결론 3줄 (사용자가 직접 작성, 절대 자동 채우지 않음) */}
          <section className="card">
            <h2>
              <span>✍️ 우리가 고칠 것 (결론 3줄 직접 작성)</span>
            </h2>
            <p className="muted-note" style={{ marginBottom: "0.85rem" }}>
              분석 결과 표와 소비자원 사고 현황을 바탕으로 회의 보고용 결론 3줄을
              직접 입력하세요.
            </p>
            <div className="conclusion-inputs">
              <div className="conclusion-row">
                <span>1.</span>
                <input
                  type="text"
                  className="conclusion-input"
                  placeholder="첫 번째 개선 과제를 직접 입력하세요"
                  value={conclusionLine1}
                  onChange={(e) => setConclusionLine1(e.target.value)}
                />
              </div>
              <div className="conclusion-row">
                <span>2.</span>
                <input
                  type="text"
                  className="conclusion-input"
                  placeholder="두 번째 개선 과제를 직접 입력하세요"
                  value={conclusionLine2}
                  onChange={(e) => setConclusionLine2(e.target.value)}
                />
              </div>
              <div className="conclusion-row">
                <span>3.</span>
                <input
                  type="text"
                  className="conclusion-input"
                  placeholder="세 번째 개선 과제를 직접 입력하세요"
                  value={conclusionLine3}
                  onChange={(e) => setConclusionLine3(e.target.value)}
                />
              </div>
            </div>
          </section>
        </div>
      </div>

      {/* 전체 리뷰 개별 분류 결과 표 */}
      {analyzedRows.length > 0 && !analysisError && (
        <section className="card">
          <h2>
            <span>4. 전체 리뷰 상세 분류 표 ({analyzedRows.length}건)</span>
            <span className="muted-note">응답 모델: {modelUsed}</span>
          </h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>번호</th>
                  <th>작성일</th>
                  <th>별점</th>
                  <th>감성</th>
                  <th>유형</th>
                  <th>안전이슈</th>
                  <th>개선요청</th>
                  <th>리뷰 내용</th>
                </tr>
              </thead>
              <tbody>
                {analyzedRows.map((row) => (
                  <tr key={row.review_no}>
                    <td>{row.review_no}</td>
                    <td>{row.written_on}</td>
                    <td>{row.rating}</td>
                    <td>
                      <span className={`tag tag-${row.sentiment}`}>
                        {row.sentiment}
                      </span>
                    </td>
                    <td>{row.categories}</td>
                    <td>
                      {row.is_safety_issue ? (
                        <span className="tag tag-safety">안전이슈</span>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td>{row.improvement_request || "-"}</td>
                    <td>{row.review_text}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* 화면 아래: Supabase에 저장된 지난 분석 이력 (분석일별 건수 · 부정 비율) */}
      <section className="card">
        <h2>
          <span>📅 저장된 지난 분석 이력 (분석일별 건수 · 부정 비율)</span>
          <span className="muted-note">Supabase review_analysis 누적 데이터</span>
        </h2>
        {historyLoading ? (
          <p className="muted-note">지난 분석 이력을 불러오는 중입니다...</p>
        ) : historyError ? (
          <div className="error-box">불러오지 못했습니다</div>
        ) : historySummaries.length === 0 ? (
          <p className="muted-note">
            아직 저장된 분석 기록이 없습니다. 위에서 CSV 파일을 업로드해 분석을
            실행하면 이곳에 분석일별로 쌓입니다.
          </p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>분석일 (analyzed_on)</th>
                  <th>저장된 총 리뷰 건수</th>
                  <th>집계 대상 건수 (광고 제외)</th>
                  <th>부정 리뷰 건수</th>
                  <th>부정 비율</th>
                </tr>
              </thead>
              <tbody>
                {historySummaries.map((item) => (
                  <tr key={item.analyzed_on}>
                    <td>
                      <strong>{item.analyzed_on}</strong>
                    </td>
                    <td>{item.totalCount}건</td>
                    <td>{item.nonAdCount}건</td>
                    <td>{item.negativeCount}건</td>
                    <td>
                      <strong style={{ color: "#b91c1c" }}>
                        {item.negativeRatio}
                      </strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
