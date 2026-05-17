import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";
import type { NextAuthOptions } from "next-auth";
import bcrypt from "bcryptjs";
import { sql, migrate } from "@/lib/db";
import { provisionPersonalOrg } from "@/lib/orgs";

let migrationDone = false;
async function ensureMigrated() {
  if (!migrationDone) {
    await migrate();
    migrationDone = true;
  }
}

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
    CredentialsProvider({
      name: "Email",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;
        await ensureMigrated();
        const rows = await sql`
          SELECT id, email, name, image, password_hash
          FROM users
          WHERE lower(email) = lower(${credentials.email})
        `;
        const user = rows[0];
        if (!user?.password_hash) return null;
        const valid = await bcrypt.compare(credentials.password, user.password_hash as string);
        if (!valid) return null;
        return { id: user.id as string, email: user.email as string, name: user.name as string, image: user.image as string };
      },
    }),
  ],
  callbacks: {
    async signIn({ account, profile }) {
      await ensureMigrated();
      if (account?.provider === "google" && profile?.sub && profile?.email) {
        await sql`
          INSERT INTO users (id, email, name, image)
          VALUES (
            ${profile.sub},
            ${profile.email},
            ${(profile as { name?: string }).name ?? ""},
            ${(profile as { picture?: string }).picture ?? ""}
          )
          ON CONFLICT (id) DO UPDATE SET
            email = EXCLUDED.email,
            name  = EXCLUDED.name,
            image = EXCLUDED.image
        `;

        // Auto-provision a personal org for new users (and any existing user
        // who signed up before this was in place). Guarded inside
        // provisionPersonalOrg so concurrent sign-ins don't race.
        const userRows = await sql`
          SELECT default_org_id FROM users WHERE id = ${profile.sub}
        `;
        if (!userRows[0]?.default_org_id) {
          await provisionPersonalOrg({
            userId: profile.sub,
            userName: (profile as { name?: string }).name ?? "",
            userEmail: profile.email,
          });
        }
      }
      return true;
    },
    session({ session, token }) {
      if (session.user && token.sub) {
        (session.user as { id?: string }).id = token.sub;
      }
      return session;
    },
  },
  pages: {
    signIn: "/",
  },
};
