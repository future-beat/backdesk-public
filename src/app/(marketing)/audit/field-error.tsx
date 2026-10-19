/**
 * The one field-error rendering, lifted out of the console's new-audit form so
 * both forms spell the D-19 accessibility contract the same way.
 *
 * `role="alert"` so a screen reader announces the message when it appears, and
 * an `id` the control points at with `aria-describedby` — a red paragraph that
 * is not bound to its input is invisible to anybody not looking at it.
 */
export function FieldError({ id, message }: { id: string; message: string | undefined }) {
  if (!message) return null;
  return (
    <p className="field-error" id={id} role="alert">
      {message}
    </p>
  );
}
