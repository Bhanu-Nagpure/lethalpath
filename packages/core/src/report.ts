/**
 * What a judge sees when the product runs.
 *
 * The banner names the sponsor and the pinned engine. The body names the
 * FalkorDB procedure that produced the grant. Neither is optional: a demo that
 * hides the database fails the "primary graph" rule even if the database did
 * the work.
 */

export const BANNER = "LethalPath  ·  powered by FalkorDB 6.0.2";

export function report(input: {
  injectedFrom: string;
  tools: string[];
  hops: number;
  grant: string;
}): string {
  const route = [input.injectedFrom, ...input.tools].join(" → ");
  return [
    BANNER,
    "",
    `Leak path   ${route}   (${input.hops} hops)`,
    `Fix         revoke ${input.grant}`,
    "Source      CALL algo.maxFlow on FalkorDB, then the residual cut",
    "",
  ].join("\n");
}
