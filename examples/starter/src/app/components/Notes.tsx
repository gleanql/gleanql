"use client";
import { useState } from "react";
import { useGlean, useMutation } from "@gleanql/client/client";

/**
 * The interactive surface — one island, zero graph glue. It reads the live
 * list through `useGlean()` (server-rendered warm, re-rendered as the cache
 * changes) and writes through a compile-time `useMutation` selector.
 * `optimisticRoots` splices the new row in before the server responds and
 * rolls back on failure; the id is generated client-side, so the optimistic
 * row IS the final row.
 */
export function Notes() {
  const glean = useGlean();
  const [text, setText] = useState("");

  const [add, { isLoading, error }] = useMutation(
    (m, vars: { id: string; text: string }) => {
      const note = m.addNote(vars);
      return [note.id, note.text];
    },
    {
      optimisticRoots: (roots, vars) =>
        roots.append("notes", { __typename: "Note", id: vars.id, text: vars.text }, { prepend: true }),
    },
  );

  const notes = glean?.notes();
  if (!notes) return null;

  const submit = async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setText("");
    await add({ id: crypto.randomUUID(), text: trimmed });
  };

  return (
    <>
      <p>
        <input
          value={text}
          placeholder="Write a note…"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
        <button type="button" disabled={isLoading} onClick={submit}>
          Add
        </button>
        {error ? <span style={{ color: "crimson" }}> {error}</span> : null}
      </p>
      <ul>
        {notes.map((note) => (
          <li key={note.id}>{note.text}</li>
        ))}
      </ul>
    </>
  );
}
