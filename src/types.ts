/**
 * Represents the possible types of MCP messages.
 */
export enum MCPMessageType {
    FunctionCall = 'function_call',
    FunctionReturn = 'function_return',
    Error = 'error',
}

/**
 * Base interface for all MCP messages.
 */
export interface MCPMessageBase {
    type: MCPMessageType;
    id: string;
}

/**
 * Represents an MCP Function Call message.
 */
export interface MCPFunctionCall extends MCPMessageBase {
    type: MCPMessageType.FunctionCall;
    function_name: string;
    parameters: Record<string, any>;
}

/**
 * Represents an MCP Function Return message.
 */
export interface MCPFunctionReturn extends MCPMessageBase {
    type: MCPMessageType.FunctionReturn;
    function_name: string;
    return_value: any;
}

/**
 * Represents an MCP Error message.
 */
export interface MCPError extends MCPMessageBase {
    type: MCPMessageType.Error;
    message: string;
    code?: string;
}

export type MCPIncomingMessage = MCPFunctionCall;

export type MCPOutgoingMessage = MCPFunctionReturn | MCPError;

/**
 * Represents a parameter definition within an MCP function.
 */
export interface MCPParameter {
    name: string;
    description?: string;
    type: string;
    required: boolean;
    schema?: any;
    _in?: 'query' | 'path' | 'header' | 'cookie' | 'body';
}

/**
 * Represents an MCP Function definition derived from an OpenAPI operation.
 */
export interface MCPFunctionDefinition {
    name: string;
    description?: string;
    parameters: MCPParameter[];
    _method: string;
    _path: string;
    _requestBodySchema?: any;
    _produces?: string[];
    _consumes?: string[];
}