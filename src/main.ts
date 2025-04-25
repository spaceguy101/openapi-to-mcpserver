import { Command } from 'commander';
import { runServer } from './server';

/**
 * Main function to set up the CLI and run the application.
 */
function main() {
    const program = new Command();

    program
        .name('openapi-to-mcp')
        .description('Convert OpenAPI specs to MCP service')
        .version('1.0.0');

    program.command('serve')
        .description('Start the MCP service')
        .option('-p, --port <number>', 'Port to listen on', '8080')
        .option('-H, --host <string>', 'Host to listen on', 'localhost')
        .option('-f, --file <string>', 'Path to the OpenAPI specification file', '')
        .action(async (options) => {
            const port = parseInt(options.port, 10);
            const host = options.host;
            const openapiFilePath = options.file;

            if (isNaN(port)) {
                console.error('Error: Invalid port number');
                process.exit(1);
            }

            if (!openapiFilePath) {
                 console.error('Error: OpenAPI specification file path is required. Use -f or --file option.');
                 process.exit(1);
            }

            try {
                await runServer(host, port, openapiFilePath);
            } catch (error) {
                console.error('Failed to start server:', error);
                process.exit(1);
            }
        });

    program.parse(process.argv);
}

main(); 