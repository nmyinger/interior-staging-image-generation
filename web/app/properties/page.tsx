import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { sql } from "@/lib/db";
import type { PropertyStatus } from "@/components/properties/StatusBadge";
import { Plus, MapPin, Building2, Image as ImageIcon } from "lucide-react";

interface PropertyRow {
  id: string;
  name: string;
  address: string | null;
  mls: string | null;
  status: PropertyStatus;
  created_at: string;
  photo_count: number;
  preview_urls: string[];
}

async function getProperties(uid: string): Promise<PropertyRow[]> {
  const userRows = await sql`SELECT default_org_id FROM users WHERE id = ${uid}`;
  const orgId = (userRows[0]?.default_org_id as string | null) ?? null;
  if (!orgId) return [];

  const rows = await sql`
    SELECT
      p.id, p.name, p.address, p.mls, p.status, p.created_at,
      COUNT(pp.id)::int AS photo_count,
      ARRAY(
        SELECT ph.image_url
        FROM property_photos pp2
        JOIN photos ph ON ph.filename = pp2.photo_filename
        WHERE pp2.property_id = p.id AND ph.image_url IS NOT NULL
        ORDER BY pp2.position
        LIMIT 3
      ) AS preview_urls
    FROM properties p
    LEFT JOIN property_photos pp ON pp.property_id = p.id
    WHERE p.org_id = ${orgId}
    GROUP BY p.id
    ORDER BY p.created_at DESC
  `;
  return rows as PropertyRow[];
}

export default async function PropertiesPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    redirect("/");
  }

  const uid = (session.user as { id?: string }).id!;
  const properties = await getProperties(uid);

  return (
    <div>
      <div className="max-w-4xl mx-auto px-6 py-8">
        {/* Page header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-lg font-semibold text-stone-900">Properties</h1>
            <p className="text-xs text-stone-400 mt-0.5">Manage your virtual staging jobs</p>
          </div>
          <Link
            href="/properties/new"
            className="flex items-center gap-1.5 text-sm font-medium text-white bg-sage-600 hover:bg-sage-700 rounded-lg px-3 py-2 transition-colors shadow-sm"
          >
            <Plus size={15} />
            New property
          </Link>
        </div>

        {/* Empty state */}
        {properties.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24 gap-4 text-stone-400">
            <div className="w-14 h-14 rounded-2xl bg-stone-100 border border-stone-200 flex items-center justify-center">
              <Building2 size={24} strokeWidth={1.25} />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-stone-600">No properties yet</p>
              <p className="text-xs text-stone-400 mt-1">Create your first property to get started</p>
            </div>
            <Link
              href="/properties/new"
              className="flex items-center gap-1.5 text-sm font-medium text-white bg-sage-600 hover:bg-sage-700 rounded-lg px-4 py-2 transition-colors shadow-sm mt-2"
            >
              <Plus size={15} />
              Create property
            </Link>
          </div>
        )}

        {/* Property cards */}
        {properties.length > 0 && (
          <div className="grid grid-cols-1 gap-3">
            {properties.map((property) => (
              <PropertyCard key={property.id} property={property} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PropertyCard({ property }: { property: PropertyRow }) {
  const date = new Date(property.created_at).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <Link
      href={`/properties/${property.id}`}
      className="block bg-white rounded-xl border border-stone-200 hover:border-stone-300 hover:shadow-sm transition-all p-5"
    >
      <div className="flex items-start gap-3 flex-wrap">
        <h2 className="text-sm font-semibold text-stone-800">{property.name}</h2>
        {property.mls && (
          <span className="inline-flex items-center gap-1 text-[11px] text-acacia-500 bg-acacia-100 border border-acacia-200 rounded-full px-2 py-0.5 font-medium">
            {property.mls}
          </span>
        )}
      </div>

      {property.address && (
        <p className="flex items-center gap-1 text-xs text-stone-400 mt-1.5">
          <MapPin size={11} className="shrink-0" />
          {property.address}
        </p>
      )}

      <div className="flex items-center gap-4 mt-2">
        <span className="flex items-center gap-1 text-[11px] text-stone-400">
          <ImageIcon size={11} />
          {property.photo_count} photo{property.photo_count !== 1 ? "s" : ""}
        </span>
        <span className="text-[11px] text-stone-400">{date}</span>
      </div>

      {property.preview_urls?.length > 0 && (
        <div className="flex gap-1.5 mt-3">
          {property.preview_urls.slice(0, 3).map((url, i) => (
            <div key={i} className="w-16 h-11 rounded-lg overflow-hidden bg-stone-100 border border-stone-200 shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="" className="w-full h-full object-cover" />
            </div>
          ))}
        </div>
      )}
    </Link>
  );
}
