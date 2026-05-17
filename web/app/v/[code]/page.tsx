export const runtime = "edge";

import { neon } from "@neondatabase/serverless";
import { ReactCompareSlider, ReactCompareSliderImage } from "react-compare-slider";
import { APP_NAME, APP_WORDMARK } from "@/lib/constants";

export async function generateMetadata() {
  return {
    title: "Virtually Staged — Photo Disclosure",
    description:
      "View the original and staged versions of this listing photo.",
    robots: { index: false, follow: false },
  };
}

interface Disclosure {
  id: string;
  org_id: string;
  property_id: string | null;
  batch_item_id: string | null;
  short_code: string;
  original_url: string;
  staged_url: string;
  mls: string | null;
  watermark_config: Record<string, unknown>;
  disclosure_text: string;
  created_at: string;
  revoked_at: string | null;
}

async function getDisclosure(code: string): Promise<Disclosure | null> {
  const sql = neon(process.env.DATABASE_URL!);
  const rows = await sql`
    SELECT * FROM disclosures
    WHERE short_code = ${code} AND revoked_at IS NULL
    LIMIT 1
  `;
  if (!rows.length) return null;
  return rows[0] as Disclosure;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default async function DisclosurePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const disclosure = await getDisclosure(code);

  if (!disclosure) {
    return (
      <main className="min-h-screen bg-stone-50 flex items-center justify-center px-4">
        <div className="max-w-md w-full text-center py-20">
          <div className="w-12 h-12 rounded-full bg-stone-200 flex items-center justify-center mx-auto mb-6">
            <svg
              width="20"
              height="20"
              viewBox="0 0 20 20"
              fill="none"
              className="text-stone-500"
            >
              <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.5" />
              <path
                d="M10 6v5M10 13.5v.5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-stone-800 mb-3">
            Disclosure unavailable
          </h1>
          <p className="text-stone-500 text-sm leading-relaxed">
            This disclosure link is no longer active. It may have been revoked
            by the listing agent. Please contact the agent for the current
            disclosure.
          </p>
        </div>
      </main>
    );
  }

  const generatedDate = formatDate(disclosure.created_at);
  const wc = disclosure.watermark_config as {
    text?: string;
    position?: string;
    sizePct?: number;
    opacity?: number;
  };

  return (
    <main className="min-h-screen bg-stone-50">
      {/* Header */}
      <header className="border-b border-stone-200 bg-white px-4 py-3 flex items-center gap-3">
        <div className="w-5 h-5 rounded bg-sage-600 flex items-center justify-center shrink-0">
          <span className="text-white text-[10px] font-bold">VS</span>
        </div>
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-semibold text-stone-800">
            {APP_WORDMARK}
          </span>
          <span className="text-stone-300 text-sm">/</span>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-acacia-100 text-acacia-500 text-xs font-semibold shrink-0">
            Virtually Staged
          </span>
        </div>
        <div className="ml-auto text-xs text-stone-400 shrink-0">
          Disclosed {generatedDate}
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 py-8 space-y-8">
        {/* Image comparison */}
        <section>
          <div className="rounded-xl overflow-hidden border border-stone-200 shadow-sm">
            <ReactCompareSlider
              itemOne={
                <ReactCompareSliderImage
                  src={disclosure.original_url}
                  alt="Original photograph"
                  style={{ objectFit: "cover" }}
                />
              }
              itemTwo={
                <ReactCompareSliderImage
                  src={disclosure.staged_url}
                  alt="Virtually staged photograph"
                  style={{ objectFit: "cover" }}
                />
              }
              style={{ width: "100%", aspectRatio: "16/9" }}
            />
          </div>
          <div className="flex justify-between mt-2 px-1">
            <span className="text-xs text-stone-400 font-medium">
              Original photograph
            </span>
            <span className="text-xs text-stone-400 font-medium">
              Virtually staged
            </span>
          </div>
        </section>

        {/* Disclosure card */}
        <section className="bg-white rounded-xl border border-stone-200 shadow-sm divide-y divide-stone-100">
          {/* Disclosure text */}
          <div className="px-6 py-5">
            <h2 className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-3">
              Disclosure Statement
            </h2>
            <p className="text-stone-700 text-sm leading-relaxed">
              {disclosure.disclosure_text}
            </p>
          </div>

          {/* Standard notices */}
          <div className="px-6 py-5 space-y-2">
            <p className="text-xs text-stone-500 leading-relaxed">
              This image was generated by artificial intelligence and is for
              illustrative purposes only. Furniture, decor, and finishes shown
              are not present in the property.
            </p>
            <p className="text-xs text-stone-500 leading-relaxed">
              The original unaltered photograph is shown on the left side of
              the comparison above.
            </p>
          </div>

          {/* Metadata grid */}
          <div className="px-6 py-5 grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-3">
            <div>
              <dt className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-1">
                Generated
              </dt>
              <dd className="text-sm text-stone-700">{generatedDate}</dd>
            </div>

            {disclosure.mls && (
              <div>
                <dt className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-1">
                  MLS Board
                </dt>
                <dd className="text-sm text-stone-700">{disclosure.mls}</dd>
              </div>
            )}

            <div>
              <dt className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-1">
                Disclosure ID
              </dt>
              <dd className="text-sm text-stone-700 font-mono">
                {disclosure.short_code}
              </dd>
            </div>
          </div>

          {/* Watermark config snapshot */}
          {Object.keys(wc).length > 0 && (
            <div className="px-6 py-5">
              <h3 className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-3">
                Watermark Rules Applied
              </h3>
              <dl className="grid grid-cols-2 gap-x-8 gap-y-2 sm:grid-cols-4">
                {wc.text && (
                  <div>
                    <dt className="text-xs text-stone-400">Label</dt>
                    <dd className="text-xs text-stone-600 font-medium">
                      {wc.text}
                    </dd>
                  </div>
                )}
                {wc.position && (
                  <div>
                    <dt className="text-xs text-stone-400">Position</dt>
                    <dd className="text-xs text-stone-600 font-medium capitalize">
                      {wc.position}
                    </dd>
                  </div>
                )}
                {wc.sizePct !== undefined && (
                  <div>
                    <dt className="text-xs text-stone-400">Size</dt>
                    <dd className="text-xs text-stone-600 font-medium">
                      {(wc.sizePct * 100).toFixed(1)}% of width
                    </dd>
                  </div>
                )}
                {wc.opacity !== undefined && (
                  <div>
                    <dt className="text-xs text-stone-400">Opacity</dt>
                    <dd className="text-xs text-stone-600 font-medium">
                      {Math.round(wc.opacity * 100)}%
                    </dd>
                  </div>
                )}
              </dl>
            </div>
          )}
        </section>

        {/* Footer */}
        <footer className="text-center pb-8">
          <p className="text-xs text-stone-400">
            This disclosure is provided in compliance with applicable MLS rules
            and state disclosure requirements.
          </p>
          <p className="text-xs text-stone-400 mt-1">
            Powered by{" "}
            <span className="text-sage-600 font-medium">{APP_NAME}</span>
          </p>
        </footer>
      </div>
    </main>
  );
}
