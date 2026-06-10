import {
  isInternalType,
  namedTypeName,
  type IntrospectionInputValue,
  type IntrospectionSchema,
  type IntrospectionType,
  type IntrospectionTypeRef,
} from "./introspection.js";
import { DEFAULT_SCALAR_TYPES, propKey, renderTs } from "./ts-render.js";

export { DEFAULT_SCALAR_TYPES } from "./ts-render.js";

/**
 * Generate branded TypeScript types from introspection.
 *
 * To app code these read as ordinary schema types (`Product`, `Image`, …); the
 * compiler recognizes them via the `__typename` brand. Nullability, lists,
 * callable fields (field arguments), enums, interfaces, unions and input objects
 * all surface — so TypeScript catches API drift (a removed/renamed field, a
 * tightened nullability) at compile time.
 */

export interface GenerateTypesOptions {
  /** TS type for each GraphQL scalar. Unlisted custom scalars default to `string`. */
  readonly scalarTypes?: Record<string, string>;
}

export function generateTypes(schema: IntrospectionSchema, options: GenerateTypesOptions = {}): string {
  const scalars = { ...DEFAULT_SCALAR_TYPES, ...options.scalarTypes };
  const ctx = { scalars };

  const blocks: string[] = [];
  blocks.push(`/** Generated from GraphQL introspection. Do not edit by hand. */`);

  for (const type of schema.types) {
    if (isInternalType(type.name) || type.kind === "SCALAR") continue;
    const block = renderTypeBlock(type, ctx);
    if (block) blocks.push(block);
  }
  return blocks.join("\n\n") + "\n";
}

interface Ctx {
  readonly scalars: Record<string, string>;
}

function renderTypeBlock(type: IntrospectionType, ctx: Ctx): string | undefined {
  switch (type.kind) {
    case "OBJECT":
      return renderObject(type, ctx, type.name);
    case "INTERFACE":
      return renderInterface(type, ctx);
    case "UNION":
      return renderUnion(type);
    case "ENUM":
      return renderEnum(type);
    case "INPUT_OBJECT":
      return renderInputObject(type, ctx);
    default:
      return undefined;
  }
}

function renderObject(type: IntrospectionType, ctx: Ctx, typename: string): string {
  const members: string[] = [`  __typename: ${JSON.stringify(typename)};`];
  for (const field of type.fields ?? []) {
    members.push("  " + renderFieldMember(field.name, field.args, field.type, ctx));
  }
  return `export interface ${type.name} {\n${members.join("\n")}\n}`;
}

function renderInterface(type: IntrospectionType, ctx: Ctx): string {
  const typenameUnion =
    type.possibleTypes && type.possibleTypes.length > 0
      ? type.possibleTypes.map((p) => JSON.stringify(namedTypeName(p))).join(" | ")
      : "string";
  const members: string[] = [`  __typename: ${typenameUnion};`];
  for (const field of type.fields ?? []) {
    members.push("  " + renderFieldMember(field.name, field.args, field.type, ctx));
  }
  return `export interface ${type.name} {\n${members.join("\n")}\n}`;
}

function renderUnion(type: IntrospectionType): string {
  const members = (type.possibleTypes ?? []).map((p) => namedTypeName(p));
  const body = members.length > 0 ? members.join(" | ") : "never";
  return `export type ${type.name} = ${body};`;
}

function renderEnum(type: IntrospectionType): string {
  const values = (type.enumValues ?? []).map((v) => JSON.stringify(v.name));
  const body = values.length > 0 ? values.join(" | ") : "never";
  return `export type ${type.name} = ${body};`;
}

function renderInputObject(type: IntrospectionType, ctx: Ctx): string {
  const members = (type.inputFields ?? []).map((f) => "  " + renderInputMember(f, ctx));
  return `export interface ${type.name} {\n${members.join("\n")}\n}`;
}

/** A field is callable when it declares arguments; otherwise it is a property. */
function renderFieldMember(
  name: string,
  args: readonly IntrospectionInputValue[],
  type: IntrospectionTypeRef,
  ctx: Ctx,
): string {
  const ret = renderTs(type, ctx.scalars);
  if (args.length > 0) {
    const argList = args.map((a) => renderInputMember(a, ctx)).join(" ");
    return `${propKey(name)}(args: { ${argList} }): ${ret};`;
  }
  return `${propKey(name)}: ${ret};`;
}

function renderInputMember(input: IntrospectionInputValue, ctx: Ctx): string {
  const optional = input.type.kind !== "NON_NULL";
  return `${propKey(input.name)}${optional ? "?" : ""}: ${renderTs(input.type, ctx.scalars)};`;
}
