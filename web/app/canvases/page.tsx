import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { sql } from "@/lib/db";
import { Layers, Clock } from "lucide-react";
import { NewCanvasButton } from "./NewCanvasButton";

interface CanvasRow {
  id: string;
  name: string;
  created_at: string;
  thumbnail_filename: string | null;
}

async function getCanvases(uid: string): Promise<CanvasRow[]> {
  const rows = await sql`
    SELECT
      s.id,
      s.name,
      s.created_at,
      (
        SELECT cn.data->>'filename'
        FROM canvas_nodes cn
        JOIN photos ph ON ph.filename = cn.data->>'filename'
        WHERE cn.session_id = s.id
          AND cn.type = 'photo'
          AND ph.image_url IS NOT NULL
        ORDER BY RANDOM()
        LIMIT 1
      ) AS thumbnail_filename
    FROM sessions s
    WHERE s.owner_user_id = ${uid}
    ORDER BY s.created_at DESC
  `;
  return rows as CanvasRow[];
}

export default async function CanvasesPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/");

  const uid = (session.user as { id?: string }).id!;
  const canvases = await getCanvases(uid);

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-semibold text-stone-900">Canvases</h1>
          <p className="text-xs text-stone-400 mt-0.5">Your interactive staging workspaces</p>
        </div>
        <NewCanvasButton />
      </div>

      {canvases.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 gap-4 text-stone-400">
          <div className="w-14 h-14 rounded-2xl bg-stone-100 border border-stone-200 flex items-center justify-center">
            <Layers size={24} strokeWidth={1.25} />
          </div>
          <div className="text-center">
            <p className="text-sm font-medium text-stone-600">No canvases yet</p>
            <p className="text-xs text-stone-400 mt-1">Create a canvas to start staging interactively</p>
          </div>
          <NewCanvasButton className="mt-2" />
        </div>
      )}

      {canvases.length > 0 && (
        <div className="grid grid-cols-1 gap-3">
          {canvases.map((canvas) => (
            <CanvasCard key={canvas.id} canvas={canvas} />
          ))}
        </div>
      )}
    </div>
  );
}

function CanvasCard({ canvas }: { canvas: CanvasRow }) {
  const date = new Date(canvas.created_at).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <Link
      href={`/canvas/${canvas.id}`}
      className="flex items-center gap-5 bg-white rounded-xl border border-stone-200 hover:border-stone-300 hover:shadow-sm transition-all px-5 py-5"
    >
      {/* Thumbnail */}
      <div className="w-20 h-14 rounded-lg overflow-hidden bg-stone-100 border border-stone-200 shrink-0 flex items-center justify-center">
        {canvas.thumbnail_filename ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/api/photos/${encodeURIComponent(canvas.thumbnail_filename)}?w=200`} alt="" className="w-full h-full object-cover" />
        ) : (
          <Layers size={18} strokeWidth={1.5} className="text-stone-400" />
        )}
      </div>

      {/* Text */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-stone-800 truncate">{canvas.name}</p>
        <p className="flex items-center gap-1 text-[11px] text-stone-400 mt-1">
          <Clock size={10} className="shrink-0" />
          {date}
        </p>
      </div>
    </Link>
  );
}
