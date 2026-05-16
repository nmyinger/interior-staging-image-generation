import {
  createHmac,
  timingSafeEqual,
  randomBytes,
  pbkdf2Sync,
} from "crypto";
import { sql } from "@/lib/db";

export type AccessRole = "owner" | "editor" | "viewer" | "none";
type AccessSource = "owner" | "invite" | "link" | "none";

// Re-export so callers don't need a separate import
export type { AccessSource };

export interface SessionAccessInfo {
  role: AccessRole;
  source: AccessSource;
  canWrite: boolean;
  canRead: boolean;
  linkAccess: "private" | "view" | "edit";
  /** True when access came via public link AND a password is set (password page must verify first). */
  needsPassword: boolean;
  /** The raw hash — needed server-side to verify the password cookie. */
  passwordHash: string | null;
}

/**
 * Resolve effective access for a user (or unauthenticated visitor) against a session.
 * uid/email are null for unauthenticated requests.
 */
export async function resolveAccess(
  sessionId: string,
  uid: string | null,
  email: string | null
): Promise<SessionAccessInfo> {
  const rows = await sql`
    SELECT owner_user_id, link_access, share_password_hash
    FROM sessions WHERE id = ${sessionId}
  `;

  if (!rows.length) {
    return { role: "none", source: "none", canWrite: false, canRead: false, linkAccess: "private", needsPassword: false, passwordHash: null };
  }

  const { owner_user_id, link_access, share_password_hash } = rows[0] as {
    owner_user_id: string;
    link_access: "private" | "view" | "edit";
    share_password_hash: string | null;
  };

  const hasPassword = !!share_password_hash;

  // Owner — full access, no password check
  if (uid && uid === owner_user_id) {
    return { role: "owner", source: "owner", canWrite: true, canRead: true, linkAccess: link_access, needsPassword: false, passwordHash: share_password_hash };
  }

  // Invited user — match by email, no password check
  if (email) {
    const normalized = email.toLowerCase().trim();
    const inviteRows = await sql`
      SELECT role FROM session_invites
      WHERE session_id = ${sessionId} AND email = ${normalized}
    `;
    if (inviteRows.length) {
      const inviteRole = inviteRows[0].role as "viewer" | "editor";
      const role: AccessRole = inviteRole === "editor" ? "editor" : "viewer";
      return { role, source: "invite", canWrite: role === "editor", canRead: true, linkAccess: link_access, needsPassword: false, passwordHash: share_password_hash };
    }
  }

  // Public link access
  if (link_access === "view") {
    return { role: "viewer", source: "link", canWrite: false, canRead: true, linkAccess: link_access, needsPassword: hasPassword, passwordHash: share_password_hash };
  }

  if (link_access === "edit") {
    if (uid) {
      // Authenticated users get editor access via link
      return { role: "editor", source: "link", canWrite: true, canRead: true, linkAccess: link_access, needsPassword: hasPassword, passwordHash: share_password_hash };
    }
    // Unauthenticated users can only view even on an edit link
    return { role: "viewer", source: "link", canWrite: false, canRead: true, linkAccess: link_access, needsPassword: hasPassword, passwordHash: share_password_hash };
  }

  // Private and not owner or invited
  return { role: "none", source: "none", canWrite: false, canRead: false, linkAccess: link_access, needsPassword: false, passwordHash: null };
}

// ---------------------------------------------------------------------------
// resolvePropertyAccess — unified model (reads from properties + sessions_legacy)
// Accepts either a real property ID or a legacy session ID (resolved via sessions_legacy).
// ---------------------------------------------------------------------------
export async function resolvePropertyAccess(
  propertyId: string,
  uid: string | null,
  email: string | null
): Promise<SessionAccessInfo> {
  // First resolve the canonical property_id in case a legacy session_id was passed
  const legacyRows = await sql`
    SELECT property_id FROM sessions_legacy WHERE session_id = ${propertyId}
  `;
  const canonicalId = legacyRows.length
    ? (legacyRows[0].property_id as string)
    : propertyId;

  const rows = await sql`
    SELECT created_by, link_access, share_password_hash
    FROM properties WHERE id = ${canonicalId}
  `;

  if (!rows.length) {
    return { role: "none", source: "none", canWrite: false, canRead: false, linkAccess: "private", needsPassword: false, passwordHash: null };
  }

  const { created_by, link_access, share_password_hash } = rows[0] as {
    created_by: string;
    link_access: "private" | "view" | "edit";
    share_password_hash: string | null;
  };

  const hasPassword = !!share_password_hash;

  if (uid && uid === created_by) {
    return { role: "owner", source: "owner", canWrite: true, canRead: true, linkAccess: link_access, needsPassword: false, passwordHash: share_password_hash };
  }

  if (email) {
    const normalized = email.toLowerCase().trim();
    const inviteRows = await sql`
      SELECT role FROM session_invites
      WHERE session_id = ${canonicalId} AND email = ${normalized}
    `;
    if (inviteRows.length) {
      const inviteRole = inviteRows[0].role as "viewer" | "editor";
      const role: AccessRole = inviteRole === "editor" ? "editor" : "viewer";
      return { role, source: "invite", canWrite: role === "editor", canRead: true, linkAccess: link_access, needsPassword: false, passwordHash: share_password_hash };
    }
  }

  if (link_access === "view") {
    return { role: "viewer", source: "link", canWrite: false, canRead: true, linkAccess: link_access, needsPassword: hasPassword, passwordHash: share_password_hash };
  }

  if (link_access === "edit") {
    if (uid) {
      return { role: "editor", source: "link", canWrite: true, canRead: true, linkAccess: link_access, needsPassword: hasPassword, passwordHash: share_password_hash };
    }
    return { role: "viewer", source: "link", canWrite: false, canRead: true, linkAccess: link_access, needsPassword: hasPassword, passwordHash: share_password_hash };
  }

  return { role: "none", source: "none", canWrite: false, canRead: false, linkAccess: link_access, needsPassword: false, passwordHash: null };
}

/** Cookie name for property-level password cookies (unified model). */
export function propertyPasswordCookieName(propertyId: string): string {
  return `ppw-${propertyId}`;
}

// ─── Password hashing (PBKDF2, OWASP 2023 parameters) ───────────────────────

const PBKDF2_ITERS = 210_000;
const PBKDF2_KEYLEN = 32;
const PBKDF2_DIGEST = "sha256";

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = pbkdf2Sync(password, salt, PBKDF2_ITERS, PBKDF2_KEYLEN, PBKDF2_DIGEST).toString("hex");
  return `pbkdf2$${PBKDF2_ITERS}$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const [, itersStr, salt, expectedHex] = parts;
  const iters = parseInt(itersStr, 10);
  if (isNaN(iters) || iters < 1) return false;
  const hash = pbkdf2Sync(password, salt, iters, PBKDF2_KEYLEN, PBKDF2_DIGEST).toString("hex");
  try {
    return timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(expectedHex, "hex"));
  } catch {
    return false;
  }
}

// ─── Password-verification cookie (stateless HMAC) ──────────────────────────
// Cookie value: `${sig}.${exp}`
// sig = HMAC-SHA256(NEXTAUTH_SECRET, `${sessionId}:${exp}:${passwordHash}`)
// Including passwordHash in the HMAC means rotating the password automatically
// invalidates all existing cookies without needing a version counter.

const PW_COOKIE_TTL = 7 * 24 * 60 * 60; // 7 days in seconds

export function passwordCookieName(sessionId: string): string {
  return `spw-${sessionId}`;
}

export function createPasswordCookie(sessionId: string, passwordHash: string): string {
  const exp = Math.floor(Date.now() / 1000) + PW_COOKIE_TTL;
  const sig = createHmac("sha256", process.env.NEXTAUTH_SECRET!)
    .update(`${sessionId}:${exp}:${passwordHash}`)
    .digest("hex");
  return `${sig}.${exp}`;
}

export function verifyPasswordCookie(
  cookieValue: string | undefined,
  sessionId: string,
  passwordHash: string
): boolean {
  if (!cookieValue) return false;
  const dot = cookieValue.lastIndexOf(".");
  if (dot === -1) return false;
  const sig = cookieValue.slice(0, dot);
  const expStr = cookieValue.slice(dot + 1);
  const exp = parseInt(expStr, 10);
  if (isNaN(exp) || Date.now() / 1000 > exp) return false;

  const expected = createHmac("sha256", process.env.NEXTAUTH_SECRET!)
    .update(`${sessionId}:${exp}:${passwordHash}`)
    .digest("hex");

  try {
    return timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}
