import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "하루살림 「클린핏 미니」 리뷰 분석기",
  description:
    "하루살림 마케팅팀 무선 청소기 클린핏 미니 월간 리뷰 분석 및 소비자 안전 위해 정보 대시보드",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
