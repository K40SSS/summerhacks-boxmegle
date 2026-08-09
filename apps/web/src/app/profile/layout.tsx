import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Profile — Boxmegle",
  description: "Your record, your bests, and every fight you've had.",
};

export default function ProfileLayout({ children }: LayoutProps<"/profile">) {
  return children;
}
