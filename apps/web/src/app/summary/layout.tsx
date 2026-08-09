import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Summary — Boxmegle",
  description: "The fight, explained back to you.",
};

export default function SummaryLayout({ children }: LayoutProps<"/summary">) {
  return children;
}
