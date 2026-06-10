import { glean } from "@gleanql/client";
import { Notes } from "@/app/components/Notes";

/**
 * The route. The bare `glean.notes()` call discovers this file as a route and
 * preloads the operation; the island's reads (`id`, `text`) fold into it, so
 * the build emits `query NotesPage { notes { id text } }` — open /__glean in
 * dev to see it. The island server-renders warm from this request's graph.
 */
export function NotesPage() {
  glean.notes();
  return (
    <main>
      <h1>Notes</h1>
      <Notes />
    </main>
  );
}
