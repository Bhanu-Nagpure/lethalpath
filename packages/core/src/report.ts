/**
 * What the product prints when it runs.
 *
 * The banner names the engine the build is verified against. The body names the
 * FalkorDB procedure that produced the grant, so the output itself says where
 * the decision came from.
 */

export const BANNER = "LethalPath  ·  verified against FalkorDB 6.0.2";

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
