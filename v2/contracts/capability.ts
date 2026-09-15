export type CapabilityId = string;

export interface ModuleManifest {
  readonly moduleId: string;
  readonly needs: readonly CapabilityId[];
  readonly provides: readonly CapabilityId[];
}

export interface CapabilityRegistration<T = unknown> {
  readonly id: CapabilityId;
  readonly value: T;
}

export interface CapabilityResolver {
  has(capabilityId: CapabilityId): boolean;
  get<T>(capabilityId: CapabilityId): T;
}

export interface CapabilityModule {
  readonly manifest: ModuleManifest;
  start(
    resolver: CapabilityResolver,
  ):
    | readonly CapabilityRegistration[]
    | Promise<readonly CapabilityRegistration[]>;
}

export interface ComposedApplication extends CapabilityResolver {
  readonly moduleIds: readonly string[];
  readonly capabilityIds: readonly CapabilityId[];
}
