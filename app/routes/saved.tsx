import type { ReactNode } from "react";
import { Link } from "react-router";
import type { Route } from "./+types/saved";
import { db } from "~/db";
import { requireUserId } from "~/lib/access.server";
import {
  listBookmarks,
  listNotes,
  type SavedLesson,
} from "~/lib/saved.server";
import { Card, CardContent } from "~/components/ui/card";
import { Bookmark, NotebookPen } from "lucide-react";
import { formatRelativeTime } from "~/lib/utils";

export function meta() {
  return [
    { title: "Saved — Cadence" },
    { name: "description", content: "Your bookmarks and notes" },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const studentId = await requireUserId(request);

  // Only the signed-in Student's own rows: a Note is private to its writer.
  return {
    savedBookmarks: listBookmarks(db, studentId),
    savedNotes: listNotes(db, studentId),
  };
}

export default function Saved({ loaderData }: Route.ComponentProps) {
  const { savedBookmarks, savedNotes } = loaderData;

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Saved</h1>
        <p className="text-sm text-muted-foreground">
          The lessons you flagged, and what you wrote about them.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <SavedSection
          title="Bookmarks"
          icon={<Bookmark className="size-4 text-muted-foreground" />}
          emptyText="No bookmarks yet."
        >
          {savedBookmarks.map((bookmark) => (
            <SavedLessonCard key={bookmark.id} lesson={bookmark} />
          ))}
        </SavedSection>

        <SavedSection
          title="Notes"
          icon={<NotebookPen className="size-4 text-muted-foreground" />}
          emptyText="No notes yet."
        >
          {savedNotes.map((note) => (
            <SavedLessonCard key={note.id} lesson={note}>
              <p className="whitespace-pre-wrap text-sm">{note.body}</p>
              <p
                suppressHydrationWarning
                className="text-xs text-muted-foreground"
              >
                Edited {formatRelativeTime(note.updatedAt)}
              </p>
            </SavedLessonCard>
          ))}
        </SavedSection>
      </div>
    </div>
  );
}

/** One list on the Saved page, with a placeholder card when it is empty. */
function SavedSection({
  title,
  icon,
  emptyText,
  children,
}: {
  title: string;
  icon: ReactNode;
  emptyText: string;
  children: ReactNode[];
}) {
  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 font-semibold">
        {icon}
        {title}
      </h2>

      {children.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {emptyText}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">{children}</div>
      )}
    </section>
  );
}

/**
 * A row on the Saved page: a link back to the Lesson, the Course and Module it
 * sits in, and anything the row adds below that.
 */
function SavedLessonCard({
  lesson,
  children,
}: {
  lesson: SavedLesson;
  children?: ReactNode;
}) {
  return (
    <Card>
      <CardContent className="space-y-1 py-3">
        <Link
          to={`/courses/${lesson.courseSlug}/lessons/${lesson.lessonId}`}
          className="text-sm font-medium hover:underline"
        >
          {lesson.lessonTitle}
        </Link>
        <p className="text-xs text-muted-foreground">
          {lesson.courseTitle} · {lesson.moduleTitle}
        </p>
        {children}
      </CardContent>
    </Card>
  );
}
