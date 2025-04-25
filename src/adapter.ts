import { OpenAPI, OpenAPIV3 } from 'openapi-types';
import { MCPParameter } from './types';
import { z, ZodTypeAny, ZodRawShape } from 'zod';

export interface SdkToolDefinition {
    name: string;
    description?: string;
    zodShape: ZodRawShape;
    _originalOperation: {
        method: string;
        path: string;
        parameters: MCPParameter[];
        consumes?: string[];
        produces?: string[];
    };
}

/**
 * Generates a unique and valid MCP function name from the OpenAPI operationId or path/method.
 */
function generateFunctionName(method: string, path: string, operation: OpenAPIV3.OperationObject): string {
    if (operation.operationId) {
        return operation.operationId.replace(/[^a-zA-Z0-9_]/g, '_');
    }
    const pathParts = path.toLowerCase().replace(/[^a-z0-9_]/g, '_').split('_').filter(p => p);
    return `${method.toLowerCase()}_${pathParts.join('_')}`;
}

/**
 * Maps OpenAPI types to Zod types.
 */
function openApiTypeToZod(schema: OpenAPIV3.SchemaObject | undefined): ZodTypeAny {
    if (!schema) return z.any();

    switch (schema.type) {
        case 'string':
            if (schema.enum) return z.enum(schema.enum as [string, ...string[]]);
            if (schema.format === 'date-time') return z.string().datetime();
            if (schema.format === 'date') return z.string().date();
            if (schema.format === 'byte') return z.string().base64();
            if (schema.format === 'binary') return z.any();
            return z.string();
        case 'integer':
            return z.number().int();
        case 'number':
            return z.number();
        case 'boolean':
            return z.boolean();
        case 'array':
            if (schema.items) {
                const itemSchema = ('$ref' in schema.items) ? z.any() : openApiTypeToZod(schema.items);
                return z.array(itemSchema);
            }
            return z.array(z.any());
        case 'object':
            if (schema.properties) {
                const shape: { [k: string]: ZodTypeAny } = {};
                for (const propName in schema.properties) {
                    const propSchema = schema.properties[propName];
                    shape[propName] = ('$ref' in propSchema) ? z.any() : openApiTypeToZod(propSchema);
                }
                const zodObject = z.object(shape);
                if (schema.additionalProperties === true) {
                    return zodObject.catchall(z.any());
                } else if (typeof schema.additionalProperties === 'object' && !('$ref' in schema.additionalProperties)) {
                    return zodObject.catchall(openApiTypeToZod(schema.additionalProperties));
                }
                return zodObject;
            }
            if (schema.additionalProperties) {
                return z.record(z.string(), z.any());
            }
            return z.object({});
        default:
            return z.any();
    }
}

/**
 * Extracts MCP parameters from OpenAPI parameters and builds Zod shape.
 */
function extractAndBuildZodShape(
    openapiParams: (OpenAPIV3.ReferenceObject | OpenAPIV3.ParameterObject)[] | undefined,
    zodShape: ZodRawShape
): MCPParameter[] {
    const mcpParams: MCPParameter[] = [];
    if (!openapiParams) {
        return mcpParams;
    }

    openapiParams.forEach(param => {
        if ('$ref' in param) {
            console.warn(`Skipping unresolved parameter reference: ${param.$ref}`);
            return;
        }

        const schema = param.schema as OpenAPIV3.SchemaObject;
        let zodType = openApiTypeToZod(schema);

        if (!param.required) {
            zodType = zodType.optional();
        }
        if (param.description) {
            zodType = zodType.describe(param.description);
        }

        zodShape[param.name] = zodType;

        mcpParams.push({
            name: param.name,
            description: param.description,
            type: schema?.type || 'any',
            required: param.required ?? false,
            schema: schema,
            _in: param.in as MCPParameter['_in'],
        });
    });

    return mcpParams;
}

/**
 * Extracts MCP parameters from an OpenAPI request body and adds to Zod shape.
 */
function extractRequestBodyAndBuildZodShape(
    requestBody: OpenAPIV3.ReferenceObject | OpenAPIV3.RequestBodyObject | undefined,
    zodShape: ZodRawShape
): MCPParameter[] {
    if (!requestBody) {
        return [];
    }
    if ('$ref' in requestBody) {
        console.warn(`Skipping unresolved request body reference: ${requestBody.$ref}`);
        return [];
    }

    const contentSchema = requestBody.content?.['application/json']?.schema ||
                          requestBody.content?.[Object.keys(requestBody.content)[0]]?.schema;

    if (!contentSchema || '$ref' in contentSchema) {
        console.warn('Request body found but no usable schema available, skipping parameter generation for body.');
        return [];
    }

    const bodyParamName = (contentSchema as any)['x-body-name'] || 'requestBody';

    let zodType = openApiTypeToZod(contentSchema);

    if (!requestBody.required) {
        zodType = zodType.optional();
    }
    if (requestBody.description) {
        zodType = zodType.describe(requestBody.description);
    }

    zodShape[bodyParamName] = zodType;

    return [{
        name: bodyParamName,
        description: requestBody.description || 'The request body.',
        type: contentSchema.type || 'object',
        required: requestBody.required ?? false,
        schema: contentSchema,
        _in: 'body',
    }];
}

/**
 * Adapts a parsed OpenAPI specification into a list of SDK Tool Definitions.
 */
export function adaptOpenAPIToSdkTools(apiSpec: OpenAPI.Document): SdkToolDefinition[] {
    const sdkTools: SdkToolDefinition[] = [];

    if (!apiSpec.paths) {
        console.warn('No paths found in the OpenAPI specification.');
        return [];
    }

    for (const path in apiSpec.paths) {
        const pathItem = apiSpec.paths[path] as OpenAPIV3.PathItemObject;

        for (const method in pathItem) {
            if (!Object.values(OpenAPIV3.HttpMethods).includes(method as OpenAPIV3.HttpMethods)) {
                continue;
            }

            const operation = pathItem[method as keyof OpenAPIV3.PathItemObject] as OpenAPIV3.OperationObject;
            if (!operation) continue;

            const functionName = generateFunctionName(method, path, operation);
            const zodShape: ZodRawShape = {};

            const paramsFromPath = extractAndBuildZodShape(pathItem.parameters, zodShape);
            const paramsFromOperation = extractAndBuildZodShape(operation.parameters, zodShape);
            const paramsFromBody = extractRequestBodyAndBuildZodShape(operation.requestBody, zodShape);

            const combinedParamsMap = new Map<string, MCPParameter>();
            paramsFromPath.forEach(p => combinedParamsMap.set(p.name, p));
            paramsFromOperation.forEach(p => combinedParamsMap.set(p.name, p));
            paramsFromBody.forEach(p => combinedParamsMap.set(p.name, p));
            const internalParams = Array.from(combinedParamsMap.values());

            const consumes = Object.keys((operation.requestBody as OpenAPIV3.RequestBodyObject)?.content || {});
            const getResponseContentKeys = (responseCode: string): string[] => {
                const responseObj = operation.responses?.[responseCode];
                if (!responseObj || '$ref' in responseObj) return [];
                return Object.keys(responseObj.content || {});
            };

            let produces = Object.keys(operation.responses || {})
                .filter(code => code.startsWith('2'))
                .flatMap(code => getResponseContentKeys(code));
            if (produces.length === 0) {
                produces = getResponseContentKeys('default');
            }
            produces = [...new Set(produces)];

            sdkTools.push({
                name: functionName,
                description: operation.summary || operation.description,
                zodShape: zodShape,
                _originalOperation: {
                    method: method.toUpperCase(),
                    path: path,
                    parameters: internalParams,
                    consumes: consumes.length > 0 ? consumes : undefined,
                    produces: produces.length > 0 ? produces : undefined,
                },
            });
        }
    }

    console.log(`Adapted ${sdkTools.length} tools from OpenAPI spec.`);
    return sdkTools;
}