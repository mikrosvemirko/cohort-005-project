/** The longest Note body a Student can save, after trimming. */
export const MAX_NOTE_LENGTH = 2000;

/** What a Student is told when their Note is over MAX_NOTE_LENGTH. */
export const NOTE_TOO_LONG_MESSAGE = `A note must be ${MAX_NOTE_LENGTH.toLocaleString("en-US")} characters or fewer.`;
