import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Begin Fight — Boxmegle",
  description: "Your match is ready.",
};

export default function BeginFightLayout({ children }: LayoutProps<"/begin_fight">) {
  return children;
}
