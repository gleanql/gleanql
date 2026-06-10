import { glean } from "@gleanql/client";
import { TodoApp } from "@/app/components/TodoApp";

/**
 * The route (RSC). Opening the `todos` list root makes this a discovered route and
 * preloads + hydrates the list, so the interactive `TodoApp` island reads warm. The
 * island folds its own `todos { id title completed }` reads into this page's operation
 * — the only graph wiring the page needs. Reading `todos.length` here also puts the
 * list in the operation and gives the island a server count to show before it hydrates.
 */
export function TodoPage() {
  // Open the `todos` list root: this makes TodoPage a discovered route and preloads +
  // hydrates the list. The island reads `glean.todos()` directly off `useGlean()` —
  // it server-renders warm (the SSR pass resolves the request's graph) and hydrates
  // against the same data, so there is no fallback flash and no server-prop passthrough.
  glean.todos();
  return (
    <div className="wrap">
      <h1>todos</h1>
      <TodoApp />
      <p className="muted" style={{ textAlign: "center", marginTop: "1rem" }}>
        Backed by a SQLite Durable Object · GraphQL · Glean compile-time reads
      </p>
    </div>
  );
}
