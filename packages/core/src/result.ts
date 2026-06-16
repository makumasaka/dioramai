import type { ZodError } from 'zod';

export type CommandErrorCode =
  | 'VALIDATION_ERROR'
  | 'COMMAND_REJECTED'
  | 'PARSE_ERROR'
  | 'SCENE_INVALID';

export type CommandIssue = {
  path: (string | number)[];
  message: string;
};

export type CommandError = {
  code: CommandErrorCode;
  message: string;
  issues?: CommandIssue[];
};

export type OkResult<T> = { ok: true; data: T };
export type ErrResult = { ok: false; error: CommandError };
export type Result<T> = OkResult<T> | ErrResult;

export const ok = <T>(data: T): OkResult<T> => ({ ok: true, data });

export const err = (error: CommandError): ErrResult => ({ ok: false, error });

export const issuesFromZod = (e: ZodError): CommandIssue[] =>
  e.issues.map((i) => ({
    path: i.path.filter(
      (segment): segment is string | number =>
        typeof segment === 'string' || typeof segment === 'number',
    ),
    message: i.message,
  }));
