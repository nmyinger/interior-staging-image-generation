import GoogleProvider from "next-auth/providers/google";
import type { NextAuthOptions } from "next-auth";
import { sql } from "@/lib/db";

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  callbacks: {
    async signIn({ account, profile }) {
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
