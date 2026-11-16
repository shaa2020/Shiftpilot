import Link from "next/link";
import { BrandMark } from "@/components/layout/brand";

export default function CareersLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-background">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <Link href="/recruitment" className="flex items-center gap-2"><BrandMark /><span className="font-semibold">Careers</span></Link>
          <Link href="/login" className="text-sm text-muted-foreground hover:text-foreground">Sign in</Link>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
      <footer className="mx-auto max-w-5xl px-4 pb-8 text-xs text-muted-foreground"><Link href="/privacy" className="hover:underline">Privacy notice</Link></footer>
    </div>
  );
}
