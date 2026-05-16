# Compliance & Disclosures

## AB 723 (California, effective Jan 2026)

Every virtually staged image must:
1. Include a visible disclosure watermark on the image itself
2. Link to a permanent public URL showing the original unaltered photo

## Disclosure creation flow

```ts
import { createDisclosure, getDisclosureUrl } from '@/lib/disclosures';

const { short_code } = await createDisclosure({
  orgId, originalUrl, stagedUrl, mls, propertyId,
});
const publicUrl = getDisclosureUrl(short_code); // https://app/v/{code}
```

The public page at `/v/[code]` (Edge runtime) shows a before/after slider (react-compare-slider). No auth required.

## Watermarking (`lib/watermark.ts`)

```ts
import { applyWatermark } from '@/lib/watermark';
const watermarked = await applyWatermark(imageBuffer, {
  text: 'Virtually Staged',
  gravity: 'SouthEast',
});
```

MLS rules (`mls_rules` table) override defaults per board. Org selects active boards in `/admin/settings`; stored in `orgs.settings.activeMls`. Rules auto-apply to all staging outputs for that org.

**Seeded MLS boards:** HAR, ACTRIS, CA-AB723, WI-Act69, CRMLS, SDMLS, Bright, FMLS, BeachesMLS

## E&O PDF export

`GET /api/admin/compliance/export?period=90` (or `?period=all`) streams a PDF built with `@react-pdf/renderer`:

```ts
import { renderToBuffer } from '@react-pdf/renderer';
import { EoReport } from '@/lib/pdf/eo-report';
const pdf = await renderToBuffer(<EoReport orgName={...} disclosures={rows} />);
```

Each row includes: thumbnails, disclosure text, MLS rule snapshot at time of creation, SHA-256 record hash. Used for insurance E&O documentation.

## Revoking a disclosure

`POST /api/admin/disclosures/[id]/revoke` sets `revoked_at`. The public `/v/[code]` page checks this and shows a "revoked" state instead of the slider. Revocation does **not** delete the record — the audit trail is preserved.

## Compliance audit table

`/admin/compliance` — filterable table of all disclosures with revocation controls and CSV export. Filters: date range, MLS board, revocation status.
