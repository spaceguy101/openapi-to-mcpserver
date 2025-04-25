import SwaggerParser from "@apidevtools/swagger-parser";
import { OpenAPI } from "openapi-types";

/**
 * Parses an OpenAPI specification file (JSON or YAML).
 */
export async function parseOpenAPI(filePath: string): Promise<OpenAPI.Document> {
    console.log(`Parsing and validating OpenAPI file: ${filePath}`);
    try {
        const api = await SwaggerParser.validate(filePath, {
             dereference: {
                 circular: false,
             },
        });
        console.log("OpenAPI specification parsed and validated successfully.");
        return api as OpenAPI.Document;
    } catch (err) {
        console.error(`Error parsing or validating OpenAPI file ${filePath}:`, err);
        throw new Error(`Failed to parse OpenAPI specification: ${(err as Error).message}`);
    }
} 