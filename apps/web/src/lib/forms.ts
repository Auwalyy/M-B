import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { ApiError, errorMessage } from './api';

/**
 * Puts server-side field errors (422/409 details) on the matching form fields.
 * Returns a message for errors that are not tied to a field.
 */
export function applyServerErrors<T extends FieldValues>(err: unknown, setError: UseFormSetError<T>, fields: readonly string[]): string | null {
  if (err instanceof ApiError) {
    let placed = false;
    for (const [field, messages] of Object.entries(err.fieldErrors)) {
      if (fields.includes(field)) {
        setError(field as Path<T>, { type: 'server', message: messages[0] });
        placed = true;
      }
    }
    if (placed && (err.status === 422 || err.status === 409)) return null;
  }
  return errorMessage(err);
}
