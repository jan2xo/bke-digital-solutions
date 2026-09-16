import type {
  CapabilityId,
  CapabilityModule,
  CapabilityRegistration,
  CapabilityResolver,
  ComposedApplication,
  ModuleManifest,
} from "../../contracts/capability";

export class CompositionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompositionError";
  }
}

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function assertManifest(manifest: ModuleManifest): void {
  if (!manifest.moduleId.trim()) {
    throw new CompositionError("Module id must not be empty.");
  }

  if (!unique(manifest.needs)) {
    throw new CompositionError(
      `Module ${manifest.moduleId} declares a capability need more than once.`,
    );
  }

  if (!unique(manifest.provides)) {
    throw new CompositionError(
      `Module ${manifest.moduleId} declares a capability provider more than once.`,
    );
  }
}

function assertRegistrationMatchesManifest(
  manifest: ModuleManifest,
  registrations: readonly CapabilityRegistration[],
): void {
  const actualIds = registrations.map((registration) => registration.id);

  if (!unique(actualIds)) {
    throw new CompositionError(
      `Module ${manifest.moduleId} returned a capability more than once.`,
    );
  }

  const expected = new Set(manifest.provides);
  const actual = new Set(actualIds);

  const missing = manifest.provides.filter((id) => !actual.has(id));
  const undeclared = actualIds.filter((id) => !expected.has(id));

  if (missing.length > 0 || undeclared.length > 0) {
    throw new CompositionError(
      `Module ${manifest.moduleId} provider output does not match its manifest. Missing: ${missing.join(", ") || "none"}; undeclared: ${undeclared.join(", ") || "none"}.`,
    );
  }
}

function scopedResolver(
  manifest: ModuleManifest,
  capabilities: ReadonlyMap<CapabilityId, unknown>,
): CapabilityResolver {
  const allowed = new Set(manifest.needs);

  function assertDeclared(capabilityId: CapabilityId): void {
    if (!allowed.has(capabilityId)) {
      throw new CompositionError(
        `Module ${manifest.moduleId} attempted undeclared capability access: ${capabilityId}.`,
      );
    }
  }

  return {
    has(capabilityId) {
      assertDeclared(capabilityId);
      return capabilities.has(capabilityId);
    },
    get<T>(capabilityId: CapabilityId): T {
      assertDeclared(capabilityId);
      if (!capabilities.has(capabilityId)) {
        throw new CompositionError(
          `Capability ${capabilityId} is not available to module ${manifest.moduleId}.`,
        );
      }
      return capabilities.get(capabilityId) as T;
    },
  };
}

export async function composeCapabilities(
  modules: readonly CapabilityModule[],
): Promise<ComposedApplication> {
  const moduleIds = modules.map((entry) => entry.manifest.moduleId);
  if (!unique(moduleIds)) {
    throw new CompositionError("Module ids must be unique.");
  }

  const declaredProviders = new Map<CapabilityId, string>();

  for (const entry of modules) {
    assertManifest(entry.manifest);

    for (const capabilityId of entry.manifest.provides) {
      const existingProvider = declaredProviders.get(capabilityId);
      if (existingProvider) {
        throw new CompositionError(
          `Capability ${capabilityId} is declared by both ${existingProvider} and ${entry.manifest.moduleId}.`,
        );
      }
      declaredProviders.set(capabilityId, entry.manifest.moduleId);
    }
  }

  const capabilities = new Map<CapabilityId, unknown>();
  const pending = [...modules];
  const startedModuleIds: string[] = [];

  while (pending.length > 0) {
    let progress = false;

    for (let index = 0; index < pending.length; ) {
      const entry = pending[index];
      const missingNeeds = entry.manifest.needs.filter(
        (capabilityId) => !capabilities.has(capabilityId),
      );

      if (missingNeeds.length > 0) {
        index += 1;
        continue;
      }

      const registrations = await entry.start(
        scopedResolver(entry.manifest, capabilities),
      );
      assertRegistrationMatchesManifest(entry.manifest, registrations);

      for (const registration of registrations) {
        capabilities.set(registration.id, registration.value);
      }

      startedModuleIds.push(entry.manifest.moduleId);
      pending.splice(index, 1);
      progress = true;
    }

    if (!progress) {
      const unresolved = pending
        .map((entry) => {
          const missing = entry.manifest.needs.filter(
            (capabilityId) => !capabilities.has(capabilityId),
          );
          return `${entry.manifest.moduleId} -> [${missing.join(", ")}]`;
        })
        .join("; ");

      throw new CompositionError(
        `Composition cannot resolve remaining module needs: ${unresolved}.`,
      );
    }
  }

  return Object.freeze({
    moduleIds: Object.freeze([...startedModuleIds]),
    capabilityIds: Object.freeze([...capabilities.keys()]),
    has(capabilityId: CapabilityId) {
      return capabilities.has(capabilityId);
    },
    get<T>(capabilityId: CapabilityId): T {
      if (!capabilities.has(capabilityId)) {
        throw new CompositionError(`Capability ${capabilityId} is not composed.`);
      }
      return capabilities.get(capabilityId) as T;
    },
  });
}
