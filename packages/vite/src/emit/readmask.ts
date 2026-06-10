import type { OperationArtifact, SchemaModel } from "@gleanql/core";

/**
 * Dev read-masking: the compiler already knows exactly which fields each
 * component reads (the read map). Expand every read-map path into the set of
 * `Type.field` pairs the component may LEGALLY touch at runtime — each hop on
 * the path plus the identity fields of every type along it — so the runtime can
 * warn when a component reads data another component fetched (Relay's masking
 * discipline, as a dev warning instead of a type wall).
 */
export function renderReadMask(
  operations: Record<string, OperationArtifact>,
  schema: SchemaModel,
): Record<string, readonly string[]> {
  const byComponent = new Map<string, Set<string>>();

  const allow = (component: Set<string>, typeName: string, field: string): void => {
    component.add(`${typeName}.${field}`);
  };
  const allowIdentity = (component: Set<string>, typeName: string): void => {
    allow(component, typeName, "__typename");
    if (schema.hasId(typeName)) allow(component, typeName, "id");
  };

  for (const op of Object.values(operations)) {
    for (const [componentName, paths] of Object.entries(op.readMap)) {
      let set = byComponent.get(componentName);
      if (!set) byComponent.set(componentName, (set = new Set()));
      for (const path of paths) {
        const [base, ...segments] = path.split(".");
        if (!base) continue;
        let typeName = base;
        allowIdentity(set, typeName);
        for (const segment of segments) {
          const def = schema.getField(typeName, segment);
          allow(set, typeName, segment);
          if (!def) break; // unresolvable hop — keep what we know, never guess
          if (schema.isLeaf(def.type)) break;
          typeName = def.type;
          allowIdentity(set, typeName);
        }
      }
    }
  }

  return Object.fromEntries([...byComponent].map(([name, pairs]) => [name, [...pairs].sort()]));
}
