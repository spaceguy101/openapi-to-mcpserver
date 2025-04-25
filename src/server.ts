import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import http from 'http';
import path from 'path';
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z, ZodRawShape } from 'zod';
import { randomUUID } from 'crypto';
import { parseOpenAPI } from './parser';
import { adaptOpenAPIToSdkTools, SdkToolDefinition } from './adapter';
import { executeApiCall } from './apiCaller';

const SSE_MESSAGE_ENDPOINT_PATH = '/messages';
const SSE_ENDPOINT_PATH = '/sse';

/**
 * Creates and configures the Express application and MCP Server infrastructure.
 */
async function createServerInfrastructure(openapiFilePath: string): Promise<{ app: Express; server: http.Server; mcpServer: McpServer; transport: StreamableHTTPServerTransport }> {
    const app = express();
    const httpServer = http.createServer(app);

    app.use(cors());
    app.use(express.json());

    console.log(`Parsing OpenAPI spec from ${openapiFilePath}`);
    const apiSpec = await parseOpenAPI(openapiFilePath);

    let apiBaseUrl: string | undefined = undefined;
    const spec = apiSpec as any;
    if (spec.swagger === '2.0') {
        const scheme = spec.schemes?.includes('https') ? 'https' : (spec.schemes?.[0] || 'http');
        const host = spec.host;
        const basePath = spec.basePath || '';
        if (host) apiBaseUrl = `${scheme}://${host}${basePath}`;
        else console.warn('Swagger 2.0: Missing host, cannot determine base URL.');
    } else if (spec.servers && spec.servers.length > 0) {
        apiBaseUrl = spec.servers[0].url;
        if (spec.servers.length > 1) console.warn(`Multiple servers found, using: ${apiBaseUrl}`);
    }
    if (!apiBaseUrl) console.warn('Could not determine API base URL. API calls might fail.');

    const mcpServer = new McpServer({
        name: "openapi-mcp-adapter",
        version: "0.1.0",
        capabilities: { tools: {} },
    });

    const sdkTools = adaptOpenAPIToSdkTools(apiSpec);

    sdkTools.forEach((toolDef: SdkToolDefinition) => {
        console.log(`Registering tool: ${toolDef.name} (Description: ${toolDef.description || 'N/A'})`);
        
        const ParamSchema = z.object(toolDef.zodShape);
        type ParamType = z.infer<typeof ParamSchema>; 

        mcpServer.tool(
            toolDef.name,
            toolDef.zodShape,
            async (args: ParamType, extra: any) => {
                console.log(`Tool invoked: ${toolDef.name} (Request ID: ${extra?.requestId || 'unknown'})`);
                try {
                    const result = await executeApiCall(apiBaseUrl, toolDef._originalOperation, args);
                    
                    let resultText: string;
                    if (result && typeof result === 'object' && result._isBinary) {
                        resultText = `Binary data received: Content-Type: ${result.contentType}, Base64 Encoded Size: ${result.data.length} bytes`;
                    } else {
                        resultText = typeof result === 'string' ? result : JSON.stringify(result, null, 2); 
                    }
                    
                    return {
                        content: [{
                            type: "text",
                            text: `Tool ${toolDef.name} executed successfully.\nResult:\n\`\`\`\n${resultText}\n\`\`\``
                        }]
                    };

                } catch (error: any) {
                    const errorMessage = `Error executing tool ${toolDef.name}: ${error.message}`;
                    console.error(`${errorMessage} (Request ID: ${extra?.requestId || 'unknown'})`);
                    throw new Error(errorMessage);
                }
            }
        );
    });

    const transport = new StreamableHTTPServerTransport({
         sessionIdGenerator: () => randomUUID(),
     });
     
    const sseTransports: Record<string, SSEServerTransport> = {};

    app.get(SSE_ENDPOINT_PATH, async (req: Request, res: Response) => {
        console.log(`SSE connection request received from ${req.ip}`);
        const sseTransport = new SSEServerTransport(SSE_MESSAGE_ENDPOINT_PATH, res);
        const sessionId = sseTransport.sessionId;
        sseTransports[sessionId] = sseTransport;
        console.log(`SSE transport created for session ${sessionId}`);

        res.on("close", () => {
            console.log(`SSE connection closed for session ${sessionId}. Cleaning up transport.`);
            delete sseTransports[sessionId];
        });

        try {
            await mcpServer.connect(sseTransport);
            console.log(`MCP Server connected to SSE transport for session ${sessionId}`);
        } catch (error) {
            console.error(`Error connecting MCP Server to SSE transport for session ${sessionId}:`, error);
            delete sseTransports[sessionId]; 
            if (!res.headersSent) {
                res.status(500).send('Failed to establish MCP connection over SSE');
            }
        }
    });

    app.post(SSE_MESSAGE_ENDPOINT_PATH, async (req: Request, res: Response) => {
        const sessionId = req.query.sessionId as string;
        if (!sessionId) {
            return res.status(400).send('Missing sessionId query parameter');
        }

        const sseTransport = sseTransports[sessionId];
        if (sseTransport) {
            console.log(`Received POST message for SSE session ${sessionId}`);
            try {
                await sseTransport.handlePostMessage(req, res, req.body);
            } catch (error) {
                 console.error(`Error handling POST message for SSE session ${sessionId}:`, error);
                 if (!res.headersSent) {
                     res.status(500).send('Error processing message');
                 }
            }
        } else {
            console.warn(`No active SSE transport found for session ${sessionId}`);
            res.status(400).send(`No active SSE transport found for session ${sessionId}`);
        }
    });

    app.get('/', (req: Request, res: Response) => {
        res.send(`openapi-to-mcp Server (using @modelcontextprotocol/sdk) is running. MCP endpoint likely managed by SDK transport.`);
    });

    app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
        console.error("Unhandled error:", err.stack);
        if (!res.headersSent) {
            res.status(500).send('Internal Server Error');
        }
    });

    return { app, server: httpServer, mcpServer, transport }; 
}

/**
 * Runs the HTTP server using the MCP SDK infrastructure.
 */
export async function runServer(host: string, port: number, openapiFilePath: string): Promise<void> {
    try {
        const { app, server, mcpServer, transport } = await createServerInfrastructure(openapiFilePath);
        const addr = `${host}:${port}`;

        await mcpServer.connect(transport);
        console.log('MCP Server connected to primary Streamable HTTP transport.');

        const setupGracefulShutdown = (signal: NodeJS.Signals) => {
            process.on(signal, () => {
                console.log(`\nReceived ${signal}. Shutting down gracefully...`);
                server.close((err) => {
                    if (err) {
                        console.error('Error during HTTP server shutdown:', err);
                        process.exit(1);
                    }
                    console.log('HTTP server shut down.');
                    process.exit(0);
                });
                setTimeout(() => {
                    console.error('Could not close connections in time, forcing shutdown');
                    process.exit(1);
                }, 10000);
            });
        };

        setupGracefulShutdown('SIGINT');
        setupGracefulShutdown('SIGTERM');

        server.listen(port, host, () => {
            console.log(`openapi-to-mcp Server (SDK) listening on http://${addr}`);
            console.log(`Using OpenAPI spec: ${path.resolve(openapiFilePath)}`);
            console.log(`Modern MCP endpoint (Streamable HTTP) managed by SDK transport.`);
            console.log(`Legacy MCP endpoint (SSE) available at GET ${SSE_ENDPOINT_PATH} and POST ${SSE_MESSAGE_ENDPOINT_PATH}`);
        });

        server.on('error', (error: NodeJS.ErrnoException) => { 
            if (error.syscall !== 'listen') throw error;
            switch (error.code) {
                case 'EACCES':
                    console.error(`Error: Port ${port} requires elevated privileges`);
                    process.exit(1); break;
                case 'EADDRINUSE':
                    console.error(`Error: Port ${port} is already in use`);
                    process.exit(1); break;
                default: throw error;
            }
        });

    } catch (error) {
        console.error("Failed to initialize or start server:", error);
        process.exit(1);
    }
}