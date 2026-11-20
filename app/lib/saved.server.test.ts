import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { UserRole } from "~/db/schema";
import {
  getNote,
  isBookmarked,
  listBookmarks,
  listNotes,
  saveNote,
  toggleBookmark,
} from "./saved.server";
import { approveRefundRequest, raiseRefundRequest } from "./refunds.server";
import { fakeNotifications } from "./notifications.fake.server";
import { MAX_NOTE_LENGTH } from "./notes";

type TestDb = ReturnType<typeof createTestDb>;

const NOW = new Date(2026, 9, 6, 12, 0, 0);

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let firstLessonId: number;
let secondLessonId: number;

/** A moment `minutes` after NOW, for ordering and "last edited" checks. */
function minutesLater(minutes: number) {
  return new Date(NOW.getTime() + minutes * 60_000);
}

/** Inserts another Student and returns their row. */
function addStudent(name: string) {
  return db
    .insert(schema.users)
    .values({
      name,
      email: `${name.toLowerCase()}@example.com`,
      role: UserRole.Student,
    })
    .returning()
    .get();
}

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);

  const module = db
    .insert(schema.modules)
    .values({ courseId: base.course.id, title: "Basics", position: 1 })
    .returning()
    .get();

  [firstLessonId, secondLessonId] = [1, 2].map(
    (position) =>
      db
        .insert(schema.lessons)
        .values({ moduleId: module.id, title: `Lesson ${position}`, position })
        .returning()
        .get().id
  );
});

describe("bookmarking a Lesson", () => {
  it("adds a Bookmark, then removes it on the second toggle", () => {
    expect(toggleBookmark(db, base.user.id, firstLessonId, NOW)).toBe(true);
    expect(isBookmarked(db, base.user.id, firstLessonId)).toBe(true);

    expect(toggleBookmark(db, base.user.id, firstLessonId, NOW)).toBe(false);
    expect(isBookmarked(db, base.user.id, firstLessonId)).toBe(false);
  });

  it("never leaves a Student with two Bookmarks on one Lesson", () => {
    toggleBookmark(db, base.user.id, firstLessonId, NOW);
    toggleBookmark(db, base.user.id, firstLessonId, NOW);
    toggleBookmark(db, base.user.id, firstLessonId, NOW);

    expect(listBookmarks(db, base.user.id)).toHaveLength(1);
  });
});

describe("saving a Note", () => {
  it("creates the Note with the body trimmed", () => {
    const result = saveNote(db, base.user.id, firstLessonId, "  Read twice.  ", NOW);

    expect(result).toMatchObject({ ok: true, note: { body: "Read twice." } });
    expect(getNote(db, base.user.id, firstLessonId)).toMatchObject({
      body: "Read twice.",
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    });
  });

  it("replaces the body and moves the last edited time on when saved again", () => {
    saveNote(db, base.user.id, firstLessonId, "First go.", NOW);
    saveNote(db, base.user.id, firstLessonId, "Second go.", minutesLater(5));

    expect(listNotes(db, base.user.id)).toHaveLength(1);
    expect(getNote(db, base.user.id, firstLessonId)).toMatchObject({
      body: "Second go.",
      createdAt: NOW.toISOString(),
      updatedAt: minutesLater(5).toISOString(),
    });
  });

  it("keeps the body exactly as typed, Markdown characters and all", () => {
    saveNote(db, base.user.id, firstLessonId, "# not a heading\n*not bold*", NOW);

    expect(getNote(db, base.user.id, firstLessonId)?.body).toBe(
      "# not a heading\n*not bold*"
    );
  });

  it("accepts a Note of exactly the maximum length", () => {
    const body = "a".repeat(MAX_NOTE_LENGTH);

    expect(saveNote(db, base.user.id, firstLessonId, body, NOW)).toMatchObject({
      ok: true,
    });
  });

  it("refuses a Note over the maximum length with a clear message", () => {
    const body = "a".repeat(MAX_NOTE_LENGTH + 1);

    expect(saveNote(db, base.user.id, firstLessonId, body, NOW)).toEqual({
      ok: false,
      error: "A note must be 2,000 characters or fewer.",
    });
    expect(getNote(db, base.user.id, firstLessonId)).toBeUndefined();
  });

  it("removes the Note when saved empty", () => {
    saveNote(db, base.user.id, firstLessonId, "Something.", NOW);

    expect(saveNote(db, base.user.id, firstLessonId, "   ", NOW)).toEqual({
      ok: true,
      note: null,
    });
    expect(getNote(db, base.user.id, firstLessonId)).toBeUndefined();
  });
});

describe("the Saved lists", () => {
  it("hold only the Student's own rows, newest first, with Lesson and Course", () => {
    const otherStudent = addStudent("Ben");
    toggleBookmark(db, base.user.id, firstLessonId, NOW);
    toggleBookmark(db, base.user.id, secondLessonId, minutesLater(1));
    toggleBookmark(db, otherStudent.id, firstLessonId, minutesLater(2));
    saveNote(db, base.user.id, secondLessonId, "Older.", NOW);
    saveNote(db, base.user.id, firstLessonId, "Newer.", minutesLater(1));
    saveNote(db, otherStudent.id, firstLessonId, "Not yours.", minutesLater(2));

    expect(listBookmarks(db, base.user.id)).toMatchObject([
      { lessonId: secondLessonId, lessonTitle: "Lesson 2", courseTitle: "Test Course", courseSlug: "test-course" },
      { lessonId: firstLessonId, lessonTitle: "Lesson 1", courseTitle: "Test Course", courseSlug: "test-course" },
    ]);
    expect(listNotes(db, base.user.id)).toMatchObject([
      { body: "Newer.", lessonId: firstLessonId, courseTitle: "Test Course" },
      { body: "Older.", lessonId: secondLessonId, courseTitle: "Test Course" },
    ]);
  });

  it("put a Note that was edited again back at the top", () => {
    saveNote(db, base.user.id, firstLessonId, "First.", NOW);
    saveNote(db, base.user.id, secondLessonId, "Second.", minutesLater(1));
    saveNote(db, base.user.id, firstLessonId, "First, edited.", minutesLater(2));

    expect(listNotes(db, base.user.id).map((note) => note.body)).toEqual([
      "First, edited.",
      "Second.",
    ]);
  });
});

describe("deleting what a Bookmark or Note hangs off", () => {
  it("removes them with the Lesson instead of blocking its delete", () => {
    toggleBookmark(db, base.user.id, firstLessonId, NOW);
    saveNote(db, base.user.id, firstLessonId, "Gone with the Lesson.", NOW);

    db.delete(schema.lessons).where(eq(schema.lessons.id, firstLessonId)).run();

    expect(listBookmarks(db, base.user.id)).toEqual([]);
    expect(listNotes(db, base.user.id)).toEqual([]);
  });

  it("removes them with the Student", () => {
    const otherStudent = addStudent("Ben");
    toggleBookmark(db, otherStudent.id, firstLessonId, NOW);
    saveNote(db, otherStudent.id, firstLessonId, "Mine.", NOW);

    db.delete(schema.users).where(eq(schema.users.id, otherStudent.id)).run();

    expect(isBookmarked(db, otherStudent.id, firstLessonId)).toBe(false);
    expect(getNote(db, otherStudent.id, firstLessonId)).toBeUndefined();
  });
});

describe("approving a Refund", () => {
  it("keeps the Student's Bookmarks and Notes", async () => {
    const notifications = fakeNotifications();
    const platformAdmin = db
      .insert(schema.users)
      .values({ name: "Pat Admin", email: "pat@example.com", role: UserRole.Admin })
      .returning()
      .get();
    const purchase = db
      .insert(schema.purchases)
      .values({
        userId: base.user.id,
        courseId: base.course.id,
        amountPaid: 7900,
        createdAt: NOW.toISOString(),
      })
      .returning()
      .get();
    db.insert(schema.enrollments)
      .values({ userId: base.user.id, courseId: base.course.id })
      .run();
    toggleBookmark(db, base.user.id, firstLessonId, NOW);
    saveNote(db, base.user.id, firstLessonId, "Keep me.", NOW);

    const raised = await raiseRefundRequest(
      db,
      purchase.id,
      base.user.id,
      "Not for me.",
      NOW,
      notifications
    );
    if (!raised.ok) throw new Error(raised.error);
    const approved = await approveRefundRequest(
      db,
      raised.refundRequestId,
      platformAdmin.id,
      null,
      NOW,
      notifications
    );

    expect(approved.ok).toBe(true);
    expect(isBookmarked(db, base.user.id, firstLessonId)).toBe(true);
    expect(getNote(db, base.user.id, firstLessonId)?.body).toBe("Keep me.");
  });
});
