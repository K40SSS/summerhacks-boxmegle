import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Queue — Boxmegle",
  description: "Searching for an opponent.",
};

export default function QueueLayout({ children }: LayoutProps<"/queue">) {
  return children;
}
