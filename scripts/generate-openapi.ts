import { buildServer } from '../src/api/server';
import * as yaml from 'js-yaml';
import fs from 'fs';
import path from 'path';

/**
 * Generate OpenAPI specification from Fastify server
 *
 * This script builds the Fastify server, extracts the OpenAPI specification,
 * and saves it to a YAML file for use in documentation.
 *
 * Usage: npm run generate:openapi
 */

/**
 * Generate operationId from HTTP method and path
 */
function generateOperationId(method: string, urlPath: string): string {
  // Convert path to camelCase operation name
  // e.g., GET /api/v1/playlists/{id} -> getPlaylistById
  const parts = urlPath
    .replace(/^\/api\/v1\//, '')
    .replace(/\{(\w+)\}/g, 'By$1')
    .split('/')
    .filter(Boolean);

  if (parts.length === 0) {
    return method.toLowerCase() + 'Root';
  }

  const [first, ...rest] = parts;
  const camelCased = first + rest.map(p =>
    p.charAt(0).toUpperCase() + p.slice(1)
  ).join('');

  return method.toLowerCase() + camelCased.charAt(0).toUpperCase() + camelCased.slice(1);
}

/**
 * Generate summary from path and method
 */
function generateSummary(method: string, urlPath: string, description?: string): string {
  if (description) {
    // Use first sentence of description as summary
    const firstSentence = description.split('.')[0].trim();
    if (firstSentence.length <= 80) {
      return firstSentence;
    }
  }

  // Generate from method and path
  const cleanPath = urlPath.replace(/^\/api\/v1\//, '').replace(/\{(\w+)\}/g, ':$1');
  const parts = cleanPath.split('/').filter(Boolean);

  const methodMap: Record<string, string> = {
    get: 'Get',
    post: 'Create',
    put: 'Update',
    patch: 'Update',
    delete: 'Delete',
  };

  const action = methodMap[method.toLowerCase()] || method;
  const resource = parts[0] || 'resource';

  if (parts.length === 1) {
    return `${action} ${resource}`;
  } else if (parts.includes(':id') || parts.some(p => p.startsWith(':'))) {
    return `${action} ${resource.slice(0, -1) || resource} by ID`;
  }

  return `${action} ${parts.join(' ')}`;
}

/**
 * Post-process OpenAPI spec to add missing summary and operationId
 */
function postProcessSpec(spec: any): any {
  if (!spec.paths) return spec;

  for (const [urlPath, pathItem] of Object.entries(spec.paths)) {
    for (const [method, operation] of Object.entries(pathItem as Record<string, any>)) {
      if (typeof operation !== 'object' || !operation) continue;

      // Skip if not a valid HTTP method
      if (!['get', 'post', 'put', 'patch', 'delete', 'options', 'head'].includes(method)) {
        continue;
      }

      // Add operationId if missing
      if (!operation.operationId) {
        operation.operationId = generateOperationId(method, urlPath);
      }

      // Add summary if missing
      if (!operation.summary) {
        operation.summary = generateSummary(method, urlPath, operation.description);
      }
    }
  }

  return spec;
}

async function generateOpenAPISpec() {
  console.log('🚀 Generating OpenAPI specification...\n');

  try {
    // Build Fastify server
    console.log('📦 Building Fastify server...');
    const fastify = await buildServer();

    // Wait for server to be ready
    await fastify.ready();

    // Get OpenAPI spec from Swagger plugin and post-process it
    let spec = fastify.swagger();
    console.log('🔧 Post-processing spec to add summary and operationId...');
    spec = postProcessSpec(spec);

    console.log('✅ OpenAPI spec generated');
    console.log(`   Title: ${spec.info.title}`);
    console.log(`   Version: ${spec.info.version}`);
    console.log(`   OpenAPI: ${spec.openapi}`);

    // Define output paths
    const outputDir = path.join(process.cwd(), 'src', 'api');
    const yamlPath = path.join(outputDir, 'openapi.yaml');
    const jsonPath = path.join(outputDir, 'openapi.json');

    // Ensure directory exists
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Save as YAML
    const yamlContent = yaml.dump(spec, {
      indent: 2,
      lineWidth: 120,
      noRefs: true,
    });
    fs.writeFileSync(yamlPath, yamlContent, 'utf-8');
    console.log(`\n📄 YAML spec saved: ${yamlPath}`);

    // Save as JSON (for tooling compatibility)
    const jsonContent = JSON.stringify(spec, null, 2);
    fs.writeFileSync(jsonPath, jsonContent, 'utf-8');
    console.log(`📄 JSON spec saved: ${jsonPath}`);

    // Print statistics
    const paths = Object.keys(spec.paths || {});
    const tags = spec.tags || [];
    const schemas = Object.keys(spec.components?.schemas || {});

    console.log('\n📊 Statistics:');
    console.log(`   Endpoints: ${paths.length}`);
    console.log(`   Tags: ${tags.length}`);
    console.log(`   Schemas: ${schemas.length}`);

    if (paths.length > 0) {
      console.log('\n🔗 Endpoints:');
      paths.forEach((p) => {
        const methods = Object.keys(spec.paths[p]);
        methods.forEach((method) => {
          const operation = spec.paths[p][method];
          console.log(`   ${method.toUpperCase().padEnd(7)} ${p}`);
          if (operation.summary) {
            console.log(`           → ${operation.summary}`);
          }
        });
      });
    }

    // Close Fastify server
    await fastify.close();

    console.log('\n✅ OpenAPI specification generated successfully!\n');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Error generating OpenAPI spec:', error);
    process.exit(1);
  }
}

// Run script
generateOpenAPISpec();
