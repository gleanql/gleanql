"use client";
import { useState } from "react";
import { useGlean, useMutation, refresh, removeFromRoot } from "@gleanql/client/client";

type Filter = "all" | "active" | "completed";

// The mutation result is the raw (normalized) response, keyed by mutation field.
type AddTodoResult = { addTodo: { __typename: "Todo"; id: string; title: string; completed: boolean } };

/**
 * The whole interactive todo app — one client island, zero graph glue. It reads the
 * live list off the hydrated graph via `useGlean()` (re-rendering as the cache changes)
 * and writes through compile-time `useMutation` selectors. Reactivity, no hand-written
 * queries anywhere:
 *  - FIELD change (toggle): the mutation returns the updated entity → it normalizes into
 *    the cache → the row flips in place.
 *  - MEMBERSHIP change (add/remove): OPTIMISTIC, declared on the mutation via
 *    `optimisticRoots` — the row appears/disappears instantly (the id is generated
 *    client-side, so the optimistic row IS the final one) and the hook rolls the splice
 *    back automatically if the mutation fails. No refetch, no hand-written rollback.
 *  - `clearCompleted` splices after the server confirms (bulk delete, no rollback needed);
 *    `toggleAll` `refresh()`es — a bulk change that returns a count, not entities.
 */
export function TodoApp({ initialCount }: { initialCount: number }) {
  const glean = useGlean();
  const [filter, setFilter] = useState<Filter>("all");
  const [draft, setDraft] = useState("");

  // Read id/title/completed in the selector so they ride back with the mutation and
  // normalize into the cache (confirming the optimistic row, idempotently). `optimisticRoots`
  // splices the row in before the request and rolls it back if the mutation fails.
  const [add] = useMutation<AddTodoResult, { id: string; title: string }>(
    (m, vars) => {
      const t = m.addTodo(vars);
      return [t.id, t.title, t.completed];
    },
    {
      optimisticRoots: (roots, vars) =>
        roots.append("todos", { __typename: "Todo", id: vars.id, title: vars.title, completed: false }, { prepend: true }),
    },
  );
  const [toggle] = useMutation((m, vars: { id: string }) => m.toggleTodo(vars).completed);
  const [remove] = useMutation<unknown, { id: string }>((m, vars) => m.removeTodo(vars), {
    optimisticRoots: (roots, vars) => roots.remove("todos", { __typename: "Todo", id: vars.id }),
  });
  const [setAll] = useMutation((m, vars: { completed: boolean }) => m.setAllCompleted(vars));
  const [clear] = useMutation((m) => m.clearCompleted());

  // The live list, read straight off the hydrated graph — the `todos` list root folds
  // `todos { id title completed }` into the page operation. Undefined only for the
  // brief moment before hydration (then `useGlean` re-renders as the page pointer
  // lands and roots resolve).
  const todos = glean?.todos();
  if (!todos) {
    return (
      <div className="app">
        <div className="empty">loading {initialCount} todo{initialCount === 1 ? "" : "s"}…</div>
      </div>
    );
  }

  // The id is generated client-side so the optimistic row is the final row. The optimistic
  // splice + rollback are declared on the mutations above — the handlers just fire them.
  const addTodo = async () => {
    const title = draft.trim();
    if (!title) return;
    setDraft("");
    await add({ id: crypto.randomUUID(), title });
  };
  const removeTodo = async (id: string) => {
    await remove({ id });
  };
  const clearCompleted = async () => {
    const done = todos.filter((t) => t.completed);
    await clear({});
    for (const t of done) removeFromRoot("todos", { __typename: "Todo", id: t.id });
  };
  const allCompleted = todos.length > 0 && todos.every((t) => t.completed);
  const toggleAll = async () => {
    await setAll({ completed: !allCompleted });
    await refresh(); // a bulk field change that returns only a count — refetch the list
  };

  const remaining = todos.filter((t) => !t.completed).length;

  return (
    <div className="app">
      <div className="add">
        {todos.length > 0 && (
          <input
            type="checkbox"
            checked={allCompleted}
            onChange={toggleAll}
            title="Toggle all"
            style={{ margin: "0 0 0 1.1rem", width: "1.25rem", height: "1.25rem", accentColor: "#d4456b" }}
          />
        )}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void addTodo();
          }}
          placeholder="What needs to be done?"
          autoFocus
        />
      </div>

      {todos.length === 0 ? (
        <div className="empty">Nothing yet — add your first todo.</div>
      ) : (
        // A single inline `.map` directly on the bound `todos` value, reading each
        // field in place — the form Glean folds from an island. Filtering is done in
        // the callback (return null) so it stays one inline chain.
        todos.map((todo) =>
          (filter === "active" && todo.completed) || (filter === "completed" && !todo.completed) ? null : (
            <div key={todo.id} className={todo.completed ? "row done" : "row"}>
              <input type="checkbox" checked={todo.completed} onChange={() => void toggle({ id: todo.id })} />
              <span className="title">{todo.title}</span>
              <button className="x" title="Delete" onClick={() => void removeTodo(todo.id)}>
                ×
              </button>
            </div>
          ),
        )
      )}

      {todos.length > 0 && (
        <div className="foot">
          <span className="muted">
            {remaining} item{remaining === 1 ? "" : "s"} left
          </span>
          <div className="filters">
            {(["all", "active", "completed"] as Filter[]).map((f) => (
              <button key={f} className={filter === f ? "on" : ""} onClick={() => setFilter(f)}>
                {f}
              </button>
            ))}
          </div>
          <button className="link" onClick={() => void clearCompleted()}>
            Clear completed
          </button>
        </div>
      )}
    </div>
  );
}
