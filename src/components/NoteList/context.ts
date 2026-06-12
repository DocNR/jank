import { createContext } from 'react'

/**
 * Set of event IDs that have just arrived in the visible feed and should
 * pulse briefly (W6 part 2). Populated by NoteList when notes enter the
 * rendered list AFTER the initial load — consumed by MainNoteCard which
 * applies the `animate-note-pulse` class while the ID is in the set.
 *
 * Lives in its own file to avoid a circular import:
 *   NoteList imports NoteCard, which imports MainNoteCard, which reads
 *   this context. Putting it here keeps MainNoteCard from importing
 *   NoteList.
 */
export const NewlyArrivedContext = createContext<Set<string>>(new Set())
