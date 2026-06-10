import type { ArgMap, Directive, SelectionSet, FieldSelection, InlineFragment } from "@gleanql/core";

/**
 * Mutable selection tree built during analysis. The analyzer attaches reads
 * freely (duplicates allowed); conversion produces IR which the core merger
 * then dedupes, aliases, injects identity into, and orders. Keeping the
 * analyzer's output un-normalized means there is exactly one canonicalization
 * implementation (the merger), shared with the q.* escape hatch.
 */
export class MutableSelection {
  readonly fields: MutableField[] = [];
  readonly inlineFragments: MutableFragment[] = [];

  constructor(readonly typeName: string) {}

  /** Find-or-create a field by (name + canonical args) so the same read shares a node. */
  field(name: string, key: string, init: () => MutableField): MutableField {
    const existing = this.fields.find((f) => f.name === name && f.key === key);
    if (existing) return existing;
    const created = init();
    this.fields.push(created);
    return created;
  }

  inlineFragment(onType: string): MutableFragment {
    let frag = this.inlineFragments.find((f) => f.onType === onType);
    if (!frag) {
      frag = { onType, selection: new MutableSelection(onType) };
      this.inlineFragments.push(frag);
    }
    return frag;
  }

  toIR(): SelectionSet {
    const fields: FieldSelection[] = this.fields.map((f) => ({
      name: f.name,
      ...(f.args ? { args: f.args } : {}),
      ...(f.directives ? { directives: f.directives } : {}),
      ...(f.child ? { selection: f.child.toIR() } : {}),
    }));
    const inlineFragments: InlineFragment[] = this.inlineFragments.map((f) => ({
      onType: f.onType,
      selection: f.selection.toIR(),
    }));
    return {
      typeName: this.typeName,
      fields,
      ...(inlineFragments.length > 0 ? { inlineFragments } : {}),
    };
  }
}

export interface MutableField {
  readonly name: string;
  /** Canonical args key, used for find-or-create dedupe within a node. */
  readonly key: string;
  args?: ArgMap;
  directives?: Directive[];
  child?: MutableSelection;
}

export interface MutableFragment {
  readonly onType: string;
  readonly selection: MutableSelection;
}
