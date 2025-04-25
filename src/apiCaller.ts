import axios from 'axios';
import { MCPParameter } from './types';

/**
 * Represents the details needed to execute an API call based on OpenAPI definition.
 */
interface OriginalOperationDetails {
    method: string;
    path: string;
    parameters: MCPParameter[];
    consumes?: string[];
    produces?: string[];
}

/**
 * Executes an API call based on the adapted OpenAPI operation details and provided arguments.
 *
 * @param apiBaseUrl The base URL of the target API.
 * @param operationDetails The original operation details stored during adaptation.
 * @param mcpArgs Arguments provided by the MCP client for the tool call.
 * @returns The API response data.
 * @throws An error if the API call fails or returns a non-success status.
 */
export async function executeApiCall(
    apiBaseUrl: string | undefined,
    operationDetails: OriginalOperationDetails,
    mcpArgs: Record<string, any>
): Promise<any> {
    if (!apiBaseUrl) {
        throw new Error('API base URL is not configured. Cannot execute API call.');
    }

    const { method, path, parameters, consumes, produces } = operationDetails;
    const headers: Record<string, string> = {};
    const queryParams: Record<string, any> = {};
    let requestBody: any = undefined;
    let urlPath = path;

    headers['Accept'] = produces?.[0] || 'application/json';

    const bodyParam = parameters.find(p => p._in === 'body');
    if (bodyParam) {
        headers['Content-Type'] = consumes?.[0] || 'application/json';
    }

    parameters.forEach((paramDef) => {
        const value = mcpArgs[paramDef.name];

        if (value === undefined) {
            if (paramDef.required) {
                throw new Error(`Missing required parameter: ${paramDef.name}`);
            }
            return;
        }

        switch (paramDef._in) {
            case 'path':
                urlPath = urlPath.replace(`{${paramDef.name}}`, encodeURIComponent(String(value)));
                break;
            case 'query':
                queryParams[paramDef.name] = value;
                break;
            case 'header':
                headers[paramDef.name] = String(value);
                break;
            case 'body':
                requestBody = value;
                if(paramDef.schema?.format === 'binary' || paramDef.schema?.type === 'string' && paramDef.schema?.format === 'binary' ) {
                    headers['Content-Type'] = 'application/octet-stream';
                    if (typeof value === 'string') {
                        try {
                            requestBody = Buffer.from(value, 'base64');
                        } catch (e) {
                            console.warn(`Failed to decode base64 for parameter ${paramDef.name}. Sending as string.`);
                        }
                    }
                }
                break;
        }
    });

    const baseUrl = apiBaseUrl.endsWith('/') ? apiBaseUrl.slice(0, -1) : apiBaseUrl;
    const targetUrl = baseUrl + (urlPath.startsWith('/') ? urlPath : '/' + urlPath);

    const acceptHeader = headers['Accept']?.toLowerCase();
    const isJsonExpected = acceptHeader?.includes('json') || acceptHeader?.includes('*/*') || !acceptHeader;
    const responseType: 'json' | 'arraybuffer' = isJsonExpected ? 'json' : 'arraybuffer';

    const config = {
        method: method,
        url: targetUrl,
        headers: headers,
        params: queryParams,
        data: requestBody,
        responseType: responseType,
    };

    console.log(`Executing API call: ${config.method} ${config.url}`);

    try {
        const response = await axios(config);
        console.log(`API call successful (${response.status}) for ${operationDetails.method} ${operationDetails.path}`);

        if (responseType === 'arraybuffer') {
            return {
                _isBinary: true,
                contentType: response.headers['content-type'],
                data: Buffer.from(response.data as ArrayBuffer).toString('base64')
            };
        }

        return response.data;
    } catch (error: any) {
        console.error(`API call failed for ${method} ${path}:`, error?.message);
        const status = error?.response?.status;
        const responseData = error?.response?.data;
        let detail = `Status: ${status || 'N/A'}`;
        if (responseData) {
            try {
                if (error?.response?.headers?.['content-type'] && !error.response.headers['content-type'].includes('json')) {
                     detail += `, Content-Type: ${error.response.headers['content-type']}`;
                 } else {
                     detail += `, Data: ${JSON.stringify(responseData)}`;
                 }
            } catch (stringifyError) {
                detail += `, Data: [Could not stringify response data]`;
            }
        }
        throw new Error(`API call failed. ${detail}`);
    }
} 