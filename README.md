# OpenAPI to MCP

Converts an OpenAPI specification file into an MCP (Machine Communication Protocol) compatible server that supports both modern Streamable HTTP and legacy SSE (Server-Sent Events) transports.

This allows AI agents or other clients that understand MCP to interact with existing web APIs described by OpenAPI specifications.

## Features

* Automatic conversion of OpenAPI operations to MCP tools
* Support for both modern Streamable HTTP and legacy SSE transports
* Automatic API base URL detection from OpenAPI specs
* Support for OpenAPI/Swagger 2.0 and OpenAPI 3.x
* Binary response handling
* Graceful shutdown handling
* Detailed logging for debugging

## Prerequisites

* Node.js (v16 or later recommended)

## Installation

1. Clone the repository (or ensure you have the `openapi-to-mcp` directory).
2. Navigate to the `openapi-to-mcp` directory:
   ```bash
   cd openapi-to-mcp
   ```
3. Install dependencies:
   ```bash
   npm install
   ```

## Build

Compile the TypeScript code to JavaScript:

```bash
npm run build
```

This will create a `dist` directory with the compiled JavaScript files.

## Usage

Start the server using the `start` script, providing the path to your OpenAPI specification file using the `-f` or `--file` option:

```bash
# Example using a local petstore.yaml file
npm start -- serve -f ./path/to/your/openapi.json

# Example with different port and host
npm start -- serve --file ./specs/petstore.json --port 9090 --host 0.0.0.0
```

* Replace `./path/to/your/openapi.json` with the actual path to your OpenAPI file.
* The server will parse the file, adapt the API operations to MCP functions, and start listening.
* It will print the available endpoints for both modern and legacy MCP connections.

## Connecting as an MCP Client

### Modern Connection (Recommended)

The server provides a modern Streamable HTTP transport managed by the MCP SDK. This is the recommended way to connect to the server.

### Legacy SSE Connection

For backwards compatibility, the server also supports SSE connections:

1. Connect to the SSE endpoint (e.g., `http://localhost:8080/sse`).
2. You will receive an `mcp-hello` event upon connection.
3. To call a function, send an MCP `function_call` message via a POST request to the `/messages` endpoint with a `sessionId` query parameter matching your SSE connection ID.

   **Example POST to `/messages?sessionId=<your_session_id>`:**

   Headers:
   ```
   Content-Type: application/json
   ```

   Body:
   ```json
   {
     "type": "function_call",
     "id": "call-123",
     "function_name": "get_pets_by_status",
     "parameters": {
       "status": "available"
     }
   }
   ```

4. The server will execute the corresponding API call and send back a `function_return` or `error` event over the established SSE connection.

## Development

Run in development mode with auto-recompilation:

```bash
# Make sure to provide the OpenAPI file path
npm run dev -- -f ./path/to/your/openapi.yaml
```

## Current Limitations

* **Authentication**: Not implemented
* **Schema Validation**: While basic schema validation is in place, some complex OpenAPI schema features (discriminators, complex compositions) might not be fully supported.
* **Testing**: No automated tests are currently included.
* **Documentation**: Individual tool documentation could be improved with more examples and parameter descriptions.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request. 