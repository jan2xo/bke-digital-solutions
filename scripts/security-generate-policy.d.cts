export type AuthorizationAssociation = "OWNER" | "MEMBER" | "COLLABORATOR" | "NONE" | string;
export type GeneratorConclusion = "success" | "failure" | "cancelled" | "timed_out" | "action_required" | "skipped" | null;

export interface Decision {
  ok?: boolean;
  action?: "continue" | "reject" | "reuse";
  reason: string;
  artifactId?: number;
}
export interface WorkflowRunFixture {
  id: number;
  head_sha: string;
  head_branch: string;
  status: string;
}
export interface ArtifactFixture {
  id: number;
  name: string;
  expired: boolean;
  workflow_run?: { id: number };
}
export interface GeneratorJobFixture {
  name: string;
  conclusion: GeneratorConclusion;
}
export function authorizeCommenter(input: { association: AuthorizationAssociation; login?: string | null; permission?: string | null }): Decision & {ok: boolean};
export function validateTarget(input: {
  contextRepository: string;
  issueNumber: number;
  isPullRequest: boolean;
  prState: string;
  baseRef: string;
  baseRepository: string;
  headRef: string;
  headRepository: string;
  sourceSha: string;
  branchSha: string;
}): Decision & {ok: boolean};
export function expectedArtifactName(sourceSha: string): string;
export function artifactBelongsToRun(artifact: ArtifactFixture | null | undefined, input: {sourceSha: string; runId: number}): boolean;
export function classifyPriorRun(input: {run: WorkflowRunFixture; sourceSha: string; generatorJob?: GeneratorJobFixture | null; artifact?: ArtifactFixture | null}): Decision & {action: "continue" | "reject" | "reuse"};
export function correlateGeneratorRun(input: {candidateRun: WorkflowRunFixture; priorRunIds: Set<number>; sourceSha: string; generatorJob?: GeneratorJobFixture | null}): boolean;
