import React from "react";
import { APP_NAME } from "@/lib/constants";
import {
  Document,
  Page,
  Text,
  View,
  Image,
  StyleSheet,
  Link,
} from "@react-pdf/renderer";
import { createHash } from "crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EoReportDisclosure {
  id: string;
  short_code: string;
  original_url: string;
  staged_url: string;
  mls: string | null;
  disclosure_text: string | null;
  created_at: string;
  revoked_at: string | null;
  property_name: string | null;
  property_address: string | null;
  mls_rule?: {
    requires_original_url: boolean;
    watermark: unknown;
  } | null;
}

export interface EoReportProps {
  orgName: string;
  generatedAt: string; // ISO
  periodLabel: string; // e.g. "All time" or "Last 90 days"
  disclosures: EoReportDisclosure[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function recordHash(d: EoReportDisclosure): string {
  const payload = JSON.stringify({
    id: d.id,
    short_code: d.short_code,
    original_url: d.original_url,
    staged_url: d.staged_url,
    mls: d.mls,
    created_at: d.created_at,
  });
  return "sha256:" + createHash("sha256").update(payload).digest("hex");
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 9,
    color: "#111",
    backgroundColor: "#fff",
    paddingTop: 40,
    paddingBottom: 50,
    paddingHorizontal: 40,
  },

  // Header
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#ddd",
  },
  headerLeft: {
    flexDirection: "column",
    gap: 2,
  },
  orgName: {
    fontFamily: "Helvetica-Bold",
    fontSize: 14,
    color: "#111",
  },
  reportTitle: {
    fontFamily: "Helvetica-Bold",
    fontSize: 11,
    color: "#333",
    marginTop: 3,
  },
  headerRight: {
    flexDirection: "column",
    alignItems: "flex-end",
    gap: 2,
  },
  headerLabel: {
    fontSize: 9,
    color: "#555",
  },
  headerValue: {
    fontFamily: "Helvetica-Bold",
    fontSize: 9,
    color: "#333",
  },

  // Summary band
  summaryBand: {
    backgroundColor: "#f4f4f4",
    borderRadius: 4,
    padding: 10,
    flexDirection: "row",
    gap: 24,
    marginBottom: 20,
  },
  summaryItem: {
    flexDirection: "column",
    gap: 2,
  },
  summaryLabel: {
    fontSize: 7,
    color: "#777",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  summaryValue: {
    fontFamily: "Helvetica-Bold",
    fontSize: 13,
    color: "#111",
  },

  // Disclosure row
  disclosureRow: {
    marginBottom: 0,
    paddingVertical: 12,
    paddingHorizontal: 10,
  },
  disclosureRowEven: {
    backgroundColor: "#f8f8f8",
  },
  disclosureRowOdd: {
    backgroundColor: "#ffffff",
  },

  rowMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 4,
  },
  rowIndex: {
    fontFamily: "Helvetica-Bold",
    fontSize: 8,
    color: "#888",
  },
  rowDate: {
    fontSize: 8,
    color: "#555",
  },
  rowMls: {
    fontFamily: "Helvetica-Bold",
    fontSize: 8,
    color: "#333",
    backgroundColor: "#e8e8e8",
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 2,
  },
  rowStatus: {
    fontSize: 8,
    color: "#555",
  },
  rowStatusRevoked: {
    fontSize: 8,
    color: "#999",
  },

  propertyName: {
    fontFamily: "Helvetica-Bold",
    fontSize: 9,
    color: "#111",
    marginBottom: 1,
  },
  propertyAddress: {
    fontSize: 8,
    color: "#555",
    marginBottom: 8,
  },

  // Thumbnails
  thumbnailRow: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 8,
  },
  thumbnailBlock: {
    flexDirection: "column",
    gap: 3,
  },
  thumbnailLabel: {
    fontSize: 7,
    color: "#777",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  thumbnail: {
    width: 120,
    height: 90,
    objectFit: "cover",
  },
  thumbnailPlaceholder: {
    width: 120,
    height: 90,
    backgroundColor: "#eee",
  },

  // Disclosure text
  disclosureTextLabel: {
    fontSize: 7,
    color: "#777",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: 2,
  },
  disclosureTextBody: {
    fontSize: 8,
    color: "#333",
    lineHeight: 1.4,
    marginBottom: 4,
  },
  disclosureUrlRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginBottom: 6,
  },
  disclosureUrlLabel: {
    fontSize: 8,
    color: "#555",
  },
  disclosureUrl: {
    fontSize: 8,
    color: "#333",
    textDecoration: "underline",
  },

  // MLS rule line
  mlsRuleLine: {
    flexDirection: "row",
    gap: 16,
    marginBottom: 6,
  },
  mlsRuleItem: {
    fontSize: 8,
    color: "#555",
  },
  mlsRuleItemBold: {
    fontFamily: "Helvetica-Bold",
    fontSize: 8,
    color: "#333",
  },

  // Record hash
  hashRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 2,
  },
  hashLabel: {
    fontSize: 7,
    color: "#aaa",
  },
  hashValue: {
    fontFamily: "Helvetica",
    fontSize: 7,
    color: "#888",
  },

  // Divider
  divider: {
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
  },

  // Page number
  pageNumber: {
    position: "absolute",
    bottom: 24,
    right: 40,
    fontSize: 8,
    color: "#aaa",
  },
});

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

function ThumbnailImage({ url, label }: { url: string; label: string }) {
  return (
    <View style={styles.thumbnailBlock}>
      <Text style={styles.thumbnailLabel}>{label}</Text>
      {/* @react-pdf/renderer fetches the URL during renderToBuffer */}
      <Image src={url} style={styles.thumbnail} />
    </View>
  );
}

function DisclosureEntry({
  disclosure,
  index,
  appBaseUrl,
}: {
  disclosure: EoReportDisclosure;
  index: number;
  appBaseUrl: string;
}) {
  const isEven = index % 2 === 0;
  const isRevoked = !!disclosure.revoked_at;
  const disclosureUrl = `${appBaseUrl}/v/${disclosure.short_code}`;
  const hash = recordHash(disclosure);

  const showOriginalUrl =
    disclosure.mls_rule?.requires_original_url === true;

  return (
    <View
      style={[
        styles.disclosureRow,
        isEven ? styles.disclosureRowEven : styles.disclosureRowOdd,
      ]}
      wrap={false}
    >
      {/* Row meta: index · date · MLS badge · status */}
      <View style={styles.rowMeta}>
        <Text style={styles.rowIndex}>#{index + 1}</Text>
        <Text style={styles.rowDate}>{formatDate(disclosure.created_at)}</Text>
        {disclosure.mls ? (
          <Text style={styles.rowMls}>{disclosure.mls}</Text>
        ) : null}
        <Text
          style={isRevoked ? styles.rowStatusRevoked : styles.rowStatus}
        >
          {isRevoked ? "REVOKED" : "ACTIVE"}
        </Text>
      </View>

      {/* Property */}
      {disclosure.property_name ? (
        <Text style={styles.propertyName}>{disclosure.property_name}</Text>
      ) : null}
      {disclosure.property_address ? (
        <Text style={styles.propertyAddress}>{disclosure.property_address}</Text>
      ) : null}

      {/* Thumbnails */}
      <View style={styles.thumbnailRow}>
        <ThumbnailImage url={disclosure.original_url} label="Original" />
        <ThumbnailImage url={disclosure.staged_url} label="Staged" />
      </View>

      {/* Disclosure text */}
      {disclosure.disclosure_text ? (
        <>
          <Text style={styles.disclosureTextLabel}>Disclosure</Text>
          <Text style={styles.disclosureTextBody}>
            &ldquo;{disclosure.disclosure_text}&rdquo;
          </Text>
        </>
      ) : null}

      {/* Disclosure URL */}
      <View style={styles.disclosureUrlRow}>
        <Text style={styles.disclosureUrlLabel}>Disclosure record:</Text>
        <Link src={disclosureUrl} style={styles.disclosureUrl}>
          {disclosureUrl}
        </Link>
      </View>

      {/* MLS rule details */}
      {disclosure.mls ? (
        <View style={styles.mlsRuleLine}>
          <Text style={styles.mlsRuleItem}>
            MLS Rule:{" "}
            <Text style={styles.mlsRuleItemBold}>{disclosure.mls}</Text>
          </Text>
          <Text style={styles.mlsRuleItem}>
            Requires original URL:{" "}
            <Text style={styles.mlsRuleItemBold}>
              {showOriginalUrl ? "Yes" : "No"}
            </Text>
          </Text>
        </View>
      ) : null}

      {/* Record hash */}
      <View style={styles.hashRow}>
        <Text style={styles.hashLabel}>Record hash:</Text>
        <Text style={styles.hashValue}>{hash}</Text>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Root document
// ---------------------------------------------------------------------------

export function EoReport({
  orgName,
  generatedAt,
  periodLabel,
  disclosures,
}: EoReportProps) {
  const appBaseUrl = process.env.NEXTAUTH_URL ?? "https://app.example.com";
  const generatedFormatted = new Date(generatedAt).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const activeCount = disclosures.filter((d) => !d.revoked_at).length;
  const revokedCount = disclosures.filter((d) => d.revoked_at).length;

  return (
    <Document
      title={`E&O Compliance Audit Report — ${orgName}`}
      author={orgName}
      subject="Errors & Omissions Compliance Audit"
      creator={`${APP_NAME} Platform`}
    >
      <Page size="LETTER" style={styles.page}>
        {/* ---------------------------------------------------------------- */}
        {/* Header                                                            */}
        {/* ---------------------------------------------------------------- */}
        <View style={styles.header} fixed>
          <View style={styles.headerLeft}>
            <Text style={styles.orgName}>{orgName}</Text>
            <Text style={styles.reportTitle}>
              E&O Compliance Audit Report
            </Text>
          </View>
          <View style={styles.headerRight}>
            <Text style={styles.headerLabel}>{APP_NAME}</Text>
            <Text style={styles.headerValue}>
              Generated: {generatedFormatted}
            </Text>
            <Text style={styles.headerLabel}>Period: {periodLabel}</Text>
          </View>
        </View>

        {/* ---------------------------------------------------------------- */}
        {/* Summary band                                                      */}
        {/* ---------------------------------------------------------------- */}
        <View style={styles.summaryBand}>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryLabel}>Total Disclosures</Text>
            <Text style={styles.summaryValue}>{disclosures.length}</Text>
          </View>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryLabel}>Active</Text>
            <Text style={styles.summaryValue}>{activeCount}</Text>
          </View>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryLabel}>Revoked</Text>
            <Text style={styles.summaryValue}>{revokedCount}</Text>
          </View>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryLabel}>Period</Text>
            <Text style={styles.summaryValue}>{periodLabel}</Text>
          </View>
        </View>

        {/* ---------------------------------------------------------------- */}
        {/* Disclosure entries                                                */}
        {/* ---------------------------------------------------------------- */}
        {disclosures.length === 0 ? (
          <View style={{ padding: 20 }}>
            <Text style={{ fontSize: 10, color: "#888", textAlign: "center" }}>
              No disclosures found for the selected period.
            </Text>
          </View>
        ) : (
          disclosures.map((d, i) => (
            <React.Fragment key={d.id}>
              <DisclosureEntry
                disclosure={d}
                index={i}
                appBaseUrl={appBaseUrl}
              />
              {i < disclosures.length - 1 && (
                <View style={styles.divider} />
              )}
            </React.Fragment>
          ))
        )}

        {/* ---------------------------------------------------------------- */}
        {/* Page numbers (fixed footer)                                       */}
        {/* ---------------------------------------------------------------- */}
        <Text
          style={styles.pageNumber}
          render={({ pageNumber, totalPages }) =>
            `Page ${pageNumber} of ${totalPages}`
          }
          fixed
        />
      </Page>
    </Document>
  );
}
