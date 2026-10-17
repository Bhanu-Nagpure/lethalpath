/**
 * Hand-rolled ANSI, zero dependencies.
 *
 * Style is on only when a real terminal is watching: a pipe, any non-empty
 * `NO_COLOR`, or `TERM=dumb` turns every helper into a pass-through, so
 * `scan | head` and the evidence logs stay byte-identical to the plain text.
 *
 * The closing codes are the specific ones (22 resets bold, 39 resets color),
 * not `0`, so styled text nests: `green(bold("0"))` keeps its color after the
 * bold ends.
 */

function colorsOn(): boolean {
  return (
    process.stdout.isTTY === true &&
    !process.env["NO_COLOR"] &&
    process.env["TERM"] !== "dumb"
  );
}

function wrap(open: number, close: number, text: string | number): string {
  const plain = String(text);
  return colorsOn() ? `\u001b[${open}m${plain}\u001b[${close}m` : plain;
}

/** Bold — the key numbers in a summary line. */
export function bold(text: string | number): string {
  return wrap(1, 22, text);
}

/** Red — blocked, leaked, revoked: the danger side of a line. */
export function red(text: string | number): string {
  return wrap(31, 39, text);
}

/** Green — safe, verified, closed. */
export function green(text: string | number): string {
  return wrap(32, 39, text);
}
