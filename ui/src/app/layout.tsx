import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agent Flight Recorder",
  description: "Black box recorder for LLM agents",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <nav className="border-b border-gray-800 bg-gray-900/80 backdrop-blur sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex h-14 items-center justify-between">
              <div className="flex items-center gap-6">
                <a
                  href="/"
                  className="text-sm font-semibold tracking-tight text-white"
                >
                  Flight Recorder
                </a>
                <div className="flex gap-4">
                  <a
                    href="/"
                    className="text-sm text-gray-400 hover:text-white transition"
                  >
                    Runs
                  </a>
                  <a
                    href="/diff"
                    className="text-sm text-gray-400 hover:text-white transition"
                  >
                    Diff
                  </a>
                </div>
              </div>
            </div>
          </div>
        </nav>
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          {children}
        </main>
      </body>
    </html>
  );
}
