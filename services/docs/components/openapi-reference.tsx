type JsonSchema = {
  $ref?: string;
  type?: string;
  format?: string;
  const?: unknown;
  enum?: unknown[];
  items?: JsonSchema;
  anyOf?: JsonSchema[];
  required?: string[];
  properties?: Record<string, JsonSchema>;
};

type OpenApiResponse = {
  description?: string;
  content?: Record<string, { schema?: JsonSchema }>;
};

type OpenApiOperation = {
  operationId?: string;
  summary?: string;
  description?: string;
  parameters?: Array<{
    name: string;
    in: string;
    required?: boolean;
    description?: string;
    schema?: JsonSchema;
  }>;
  requestBody?: {
    required?: boolean;
    content?: Record<string, { schema?: JsonSchema }>;
  };
  responses?: Record<string, OpenApiResponse>;
};

type OpenApiDocument = {
  paths: Record<string, Record<string, OpenApiOperation>>;
};

const methods = new Set(["get", "post", "put", "patch", "delete"]);

export function OpenApiReference({ spec }: { spec: OpenApiDocument }) {
  const operations = Object.entries(spec.paths).flatMap(([path, pathItem]) =>
    Object.entries(pathItem)
      .filter(([method]) => methods.has(method))
      .map(([method, operation]) => ({ method, operation, path }))
  );

  return (
    <div className="not-prose mt-6 grid gap-6">
      {operations.map(({ method, operation, path }) => (
        <section
          className="rounded-lg border border-fd-border bg-fd-card p-5"
          id={operation.operationId}
          key={`${method}:${path}`}
        >
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 font-mono text-xs font-semibold uppercase text-emerald-700 dark:text-emerald-300">
              {method}
            </span>
            <code className="text-sm text-fd-foreground">{path}</code>
          </div>

          <h2 className="mt-4 text-lg font-semibold text-fd-foreground">
            {operation.summary ?? operation.operationId ?? path}
          </h2>
          {operation.description ? (
            <p className="mt-2 max-w-3xl text-sm leading-6 text-fd-muted-foreground">
              {operation.description}
            </p>
          ) : null}

          {operation.parameters?.length ? (
            <div className="mt-5 grid gap-3">
              <h3 className="text-sm font-semibold text-fd-foreground">
                Parameters
              </h3>
              {operation.parameters.map((parameter) => (
                <div
                  className="rounded-md border border-fd-border p-3 text-sm"
                  key={`${parameter.in}:${parameter.name}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <code>{parameter.name}</code>
                    <span className="text-xs text-fd-muted-foreground">
                      {parameter.in} ·{" "}
                      {parameter.schema
                        ? describeSchema(parameter.schema)
                        : "value"}{" "}
                      · {parameter.required ? "required" : "optional"}
                    </span>
                  </div>
                  {parameter.description ? (
                    <p className="mt-2 text-sm text-fd-muted-foreground">
                      {parameter.description}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          {operation.requestBody?.content ? (
            <div className="mt-5 grid gap-3">
              <h3 className="text-sm font-semibold text-fd-foreground">
                Request body
              </h3>
              {Object.entries(operation.requestBody.content).map(
                ([mediaType, value]) => (
                  <div
                    className="rounded-md border border-fd-border p-3 text-sm text-fd-muted-foreground"
                    key={mediaType}
                  >
                    <code>{mediaType}</code>
                    {value.schema ? ` · ${describeSchema(value.schema)}` : null}
                    {operation.requestBody?.required ? " · required" : null}
                  </div>
                )
              )}
            </div>
          ) : null}

          <div className="mt-5 grid gap-3">
            <h3 className="text-sm font-semibold text-fd-foreground">Responses</h3>
            {Object.entries(operation.responses ?? {}).map(
              ([status, response]) => (
                <div
                  className="rounded-md border border-fd-border p-3 text-sm"
                  key={status}
                >
                  <div className="flex items-center gap-2">
                    <code className="rounded bg-fd-muted px-2 py-1 text-xs">
                      {status}
                    </code>
                    <span className="text-fd-muted-foreground">
                      {response.description}
                    </span>
                  </div>
                  {response.content ? (
                    <div className="mt-3 grid gap-2">
                      {Object.entries(response.content).map(([mediaType, value]) => (
                        <div className="text-xs text-fd-muted-foreground" key={mediaType}>
                          <code>{mediaType}</code>
                          {value.schema ? ` · ${describeSchema(value.schema)}` : null}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              )
            )}
          </div>
        </section>
      ))}
    </div>
  );
}

function describeSchema(schema: JsonSchema): string {
  if (schema.$ref) {
    return schema.$ref.split("/").at(-1) ?? "value";
  }

  if (schema.anyOf) {
    return schema.anyOf.map(describeSchema).join(" or ");
  }

  if (schema.enum) {
    return schema.enum.map(String).join(" | ");
  }

  if (schema.type === "array") {
    return `array of ${schema.items ? describeSchema(schema.items) : "values"}`;
  }

  if (schema.type !== "object" || !schema.properties) {
    return schema.format
      ? `${schema.type ?? "value"} (${schema.format})`
      : schema.type ?? "value";
  }

  return Object.entries(schema.properties)
    .map(([name, property]) => {
      const required = schema.required?.includes(name) ? "required" : "optional";
      const value = property.const === undefined
        ? describeSchema(property)
        : JSON.stringify(property.const);
      return `${name}: ${value} (${required})`;
    })
    .join(", ");
}
