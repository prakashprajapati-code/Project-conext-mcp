import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";

import { buildTaskContext } from "../context/context-builder.js";
import { findTestsFor } from "../context/test-locator.js";
import { searchFiles } from "../tools/content-search.js";
import { FileReader } from "../tools/file-reader.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const configPath = path.resolve(
  __dirname,
  "../../config/project.json"
);

const graphPath = path.resolve(
  __dirname,
  "../../tasks/shopdot-dependency-graph.json"
);

function createServer() {
  const server = new McpServer({
    name: "shopdot-ai-agent",
    version: "1.0.0"
  });

  // Tool 1: Return ShopDot project architecture information.
  server.registerTool(
    "get_project_architecture",
    {
      title: "Get ShopDot Project Architecture",
      description:
        "Returns ShopDot project configuration and dependency graph statistics.",
      inputSchema: z.object({}),
      annotations: {
        readOnlyHint: true
      }
    },
    async () => {
      try {
        const [configContent, graphContent] = await Promise.all([
          fs.readFile(configPath, "utf8"),
          fs.readFile(graphPath, "utf8")
        ]);

        const config = JSON.parse(configContent);
        const graph = JSON.parse(graphContent);

        const byType = Object.values(graph.types ?? {}).reduce(
          (acc, type) => {
            acc[type] = (acc[type] ?? 0) + 1;
            return acc;
          },
          {}
        );

        const result = {
          project: {
            id: config.id,
            name: config.name,
            framework: config.framework,
            language: config.language,
            database: config.database,
            orm: config.orm,
            readOnly: config.readOnly
          },
          dependencyGraph: {
            entry: graph.entry,
            totalFiles: graph.nodes.length,
            totalRelationships: graph.edges.length,
            byType,
            modelCoverage: `${byType.model ?? 0} models`,
            generatedAt: graph.meta?.generatedAt ?? null
          }
        };

        return {
          content: [{
            type: "text",
            text: JSON.stringify(result, null, 2)
          }],
          structuredContent: result
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Architecture error: ${error.message}`
          }],
          isError: true
        };
      }
    }
  );

  // Tool 2: Find files related to a development task.
  server.registerTool(
    "get_task_context",
    {
      title: "Get ShopDot Task Context",
      description:
        "Finds ShopDot backend files and dependency relationships relevant to a development task. Uses file-path keyword matching.",
      inputSchema: z.object({
        task: z.string().min(5).max(500)
          .describe("Development task, e.g. Add pagination to brand products API")
      }),
      annotations: {
        readOnlyHint: true
      }
    },
    async ({ task }) => {
      try {
        const result = await buildTaskContext(task);

        return {
          content: [{
            type: "text",
            text: JSON.stringify(result, null, 2)
          }],
          structuredContent: result
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Task context error: ${error.message}`
          }],
          isError: true
        };
      }
    }
  );

  // Tool 3: Read a single file from the target project (read-only).
  server.registerTool(
    "get_file",
    {
      title: "Get ShopDot File",
      description:
        "Returns the contents of a single file inside the ShopDot backend. Read-only.",
      inputSchema: z.object({
        path: z.string().min(1).max(500)
          .describe("Project-relative path, e.g. app/api/v1/modules/brand/routes/brand.route.js"),
        maxLines: z.number().int().min(1).max(5000).optional()
          .describe("Optional maximum number of lines to return")
      }),
      annotations: {
        readOnlyHint: true
      }
    },
    async ({ path: relativePath, maxLines }) => {
      try {
        const config = JSON.parse(
          await fs.readFile(configPath, "utf8")
        );

        const reader = new FileReader(config.root);
        const file = await reader.read(relativePath);

        const lines = file.content.split("\n");
        const content = maxLines
          ? lines.slice(0, maxLines).join("\n")
          : file.content;

        const result = {
          path: file.path,
          totalLines: file.lines,
          returnedLines: maxLines
            ? Math.min(maxLines, file.lines)
            : file.lines,
          content
        };

        return {
          content: [{
            type: "text",
            text: JSON.stringify(result, null, 2)
          }],
          structuredContent: result
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Get file error: ${error.message}`
          }],
          isError: true
        };
      }
    }
  );

  // Tool 4: Content search across the target project (read-only).
  server.registerTool(
    "search_files",
    {
      title: "Search ShopDot Files",
      description:
        "Searches file contents in the ShopDot backend. Useful when a task word does not appear in file paths (e.g. \"pagination\"). Read-only.",
      inputSchema: z.object({
        query: z.string().min(2).max(200)
          .describe("Text or regex to search for"),
        regex: z.boolean().optional()
          .describe("Treat query as a regular expression"),
        pathPrefix: z.string().optional()
          .describe("Only search files whose path starts with this prefix, e.g. app/"),
        maxResults: z.number().int().min(1).max(200).optional()
          .describe("Maximum matches to return (default 50)")
      }),
      annotations: {
        readOnlyHint: true
      }
    },
    async ({ query, regex, pathPrefix, maxResults }) => {
      try {
        const config = JSON.parse(
          await fs.readFile(configPath, "utf8")
        );

        const result = await searchFiles(config.root, query, {
          regex,
          pathPrefix,
          maxResults
        });

        return {
          content: [{
            type: "text",
            text: JSON.stringify(result, null, 2)
          }],
          structuredContent: result
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Search error: ${error.message}`
          }],
          isError: true
        };
      }
    }
  );

  // Tool 5: Find tests related to a task (read-only).
  server.registerTool(
    "get_tests_for",
    {
      title: "Get Tests For Task",
      description:
        "Finds test files related to a development task using the indexed test list. Read-only.",
      inputSchema: z.object({
        task: z.string().min(5).max(500)
          .describe("Development task, e.g. Add pagination to brand products API"),
        maxResults: z.number().int().min(1).max(100).optional()
      }),
      annotations: {
        readOnlyHint: true
      }
    },
    async ({ task, maxResults }) => {
      try {
        const result = await findTestsFor(task, {
          maxResults
        });

        return {
          content: [{
            type: "text",
            text: JSON.stringify(result, null, 2)
          }],
          structuredContent: result
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Tests lookup error: ${error.message}`
          }],
          isError: true
        };
      }
    }
  );

  return server;
}

async function main() {
  let res = await serveStdio(createServer);
}

main().catch(error => {
  // Never use console.log in an stdio MCP server.
  console.error("ShopDot MCP server failed:", error);
  process.exitCode = 1;
});
