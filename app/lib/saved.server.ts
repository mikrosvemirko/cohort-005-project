import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { and, desc, eq } from "drizzle-orm";
import * as schema from "~/db/schema";
import { bookmarks, courses, lessons, modules, notes } from "~/db/schema";
import { MAX_NOTE_LENGTH } from "~/lib/notes";

// ─── Bookmarks and Notes ───
// What a Student attaches to a Lesson for themselves and nobody else. See
// GLOSSARY.md. A Note is private: nothing outside the owning Student's Lesson
// page and Saved page may read Note bodies, so every read here is scoped to
// one Student.
//
// Every function takes the database first, so tests can hand in an in-memory
// one. Uses positional parameters (project convention).

export type Db = BetterSQLite3Database<typeof schema>;

type Note = typeof notes.$inferSelect;

/** Whether the Student has a Bookmark on the Lesson. */
export function isBookmarked(db: Db, studentId: number, lessonId: number) {
  return !!db
    .select({ id: bookmarks.id })
    .from(bookmarks)
    .where(
      and(eq(bookmarks.userId, studentId), eq(bookmarks.lessonId, lessonId))
    )
    .get();
}

/**
 * Adds the Student's Bookmark on the Lesson, or removes it if there is one.
 * Returns whether the Lesson is bookmarked afterwards. The unique index on
 * (user, lesson) means two racing adds still leave a single Bookmark.
 */
export function toggleBookmark(
  db: Db,
  studentId: number,
  lessonId: number,
  now: Date
): boolean {
  const removed = db
    .delete(bookmarks)
    .where(
      and(eq(bookmarks.userId, studentId), eq(bookmarks.lessonId, lessonId))
    )
    .returning({ id: bookmarks.id })
    .all();
  if (removed.length > 0) return false;

  db.insert(bookmarks)
    .values({ userId: studentId, lessonId, createdAt: now.toISOString() })
    .onConflictDoNothing()
    .run();
  return true;
}

/** The Student's own Note on the Lesson, if they have written one. */
export function getNote(
  db: Db,
  studentId: number,
  lessonId: number
): Note | undefined {
  return db
    .select()
    .from(notes)
    .where(and(eq(notes.userId, studentId), eq(notes.lessonId, lessonId)))
    .get();
}

export type SaveNoteResult =
  | { ok: true; note: Note | null }
  | { ok: false; error: string };

/**
 * Saves the Student's Note on the Lesson. The body is trimmed and refused if
 * it is over MAX_NOTE_LENGTH. Saving again replaces the body and moves
 * `updatedAt` on; `createdAt` is kept. Saving an empty body removes the Note,
 * so clearing the box and saving is how a Student deletes one.
 */
export function saveNote(
  db: Db,
  studentId: number,
  lessonId: number,
  body: string,
  now: Date
): SaveNoteResult {
  const trimmed = body.trim();
  if (trimmed.length > MAX_NOTE_LENGTH) {
    return {
      ok: false,
      error: `A note must be ${MAX_NOTE_LENGTH.toLocaleString("en-US")} characters or fewer.`,
    };
  }

  if (trimmed.length === 0) {
    db.delete(notes)
      .where(and(eq(notes.userId, studentId), eq(notes.lessonId, lessonId)))
      .run();
    return { ok: true, note: null };
  }

  const timestamp = now.toISOString();
  const note = db
    .insert(notes)
    .values({
      userId: studentId,
      lessonId,
      body: trimmed,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .onConflictDoUpdate({
      target: [notes.userId, notes.lessonId],
      set: { body: trimmed, updatedAt: timestamp },
    })
    .returning()
    .get();

  return { ok: true, note };
}

/** The Lesson a Bookmark or Note points at, and the Course it belongs to. */
export type SavedLesson = {
  lessonId: number;
  lessonTitle: string;
  moduleTitle: string;
  courseTitle: string;
  courseSlug: string;
};

const lessonColumns = {
  lessonId: lessons.id,
  lessonTitle: lessons.title,
  moduleTitle: modules.title,
  courseTitle: courses.title,
  courseSlug: courses.slug,
};

/** The Student's Bookmarks for the Saved page, newest first. */
export function listBookmarks(db: Db, studentId: number) {
  return db
    .select({ id: bookmarks.id, createdAt: bookmarks.createdAt, ...lessonColumns })
    .from(bookmarks)
    .innerJoin(lessons, eq(lessons.id, bookmarks.lessonId))
    .innerJoin(modules, eq(modules.id, lessons.moduleId))
    .innerJoin(courses, eq(courses.id, modules.courseId))
    .where(eq(bookmarks.userId, studentId))
    .orderBy(desc(bookmarks.createdAt), desc(bookmarks.id))
    .all();
}

/** The Student's Notes for the Saved page, most recently edited first. */
export function listNotes(db: Db, studentId: number) {
  return db
    .select({
      id: notes.id,
      body: notes.body,
      updatedAt: notes.updatedAt,
      ...lessonColumns,
    })
    .from(notes)
    .innerJoin(lessons, eq(lessons.id, notes.lessonId))
    .innerJoin(modules, eq(modules.id, lessons.moduleId))
    .innerJoin(courses, eq(courses.id, modules.courseId))
    .where(eq(notes.userId, studentId))
    .orderBy(desc(notes.updatedAt), desc(notes.id))
    .all();
}
