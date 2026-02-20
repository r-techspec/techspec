import { z } from 'zod';

/**
 * JSON Schema type for tool parameter validation
 * Requirement 6.2: Validate parameters against JSON schema
 */
export interface JSONSchema {
  type: 'object' | 'string' | 'number' | 'boolean' | 'array';
  properties?: Record<string, JSONSchemaProperty>;
  required?: string[];
  items?: JSONSchemaProperty;
  additionalProperties?: boolean;
}

export interface JSONSchemaProperty {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description?: string;
  enum?: string[];
  default?: unknown;
  items?: JSONSchemaProperty;
  properties?: Record<string, JSONSchemaProperty>;
  required?: string[];
}

/**
 * Tool definition interface
 * Requirement 6.5: Support tool registration for extensibility
 */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: JSONSchema;
}

/**
 * Tool call request
 */
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * Tool execution result
 * Requirement 6.4: Return structured errors with details
 */
export interface ToolResult {
  callId: string;
  success: boolean;
  output?: string;
  error?: ToolError;
}

/**
 * Structured tool error
 * Requirement 6.4: Include tool name, error type, message
 */
export interface ToolError {
  toolName: string;
  errorType: 'validation' | 'execution' | 'timeout' | 'not_found';
  message: string;
  details?: unknown;
}

/**
 * Tool handler function type
 */
export type ToolHandler = (args: Record<string, unknown>) => Promise<string>;

/**
 * Registered tool with handler
 */
interface RegisteredTool {
  definition: ToolDefinition;
  handler: ToolHandler;
}

/**
 * ToolSystem - Manages tool registration, validation, and execution
 * 
 * Requirements:
 * - 6.2: Validate parameters against JSON schema
 * - 6.4: Return structured errors with details
 * - 6.5: Support tool registration for extensibility
 */
export class ToolSystem {
  private tools: Map<string, RegisteredTool> = new Map();

  /**
   * Registers a tool with its handler
   * Requirement 6.5: Allow registering custom tools
   */
  register(definition: ToolDefinition, handler: ToolHandler): void {
    if (this.tools.has(definition.name)) {
      throw new Error(`Tool '${definition.name}' is already registered`);
    }
    this.tools.set(definition.name, { definition, handler });
  }

  /**
   * Unregisters a tool by name
   */
  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  /**
   * Lists all registered tool definitions
   */
  list(): ToolDefinition[] {
    return Array.from(this.tools.values()).map(t => t.definition);
  }

  /**
   * Gets a tool definition by name
   */
  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name)?.definition;
  }

  /**
   * Checks if a tool is registered
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Validates tool parameters against the tool's JSON schema
   * Requirement 6.2: Validate parameters against JSON schema
   */
  validateParameters(toolName: string, args: Record<string, unknown>): { valid: boolean; errors?: string[] } {
    const tool = this.tools.get(toolName);
    if (!tool) {
      return { valid: false, errors: [`Tool '${toolName}' not found`] };
    }

    const schema = tool.definition.parameters;
    const errors: string[] = [];

    // Check required properties
    if (schema.required) {
      for (const required of schema.required) {
        if (!(required in args)) {
          errors.push(`Missing required parameter: '${required}'`);
        }
      }
    }

    // Validate property types
    if (schema.properties) {
      for (const [key, value] of Object.entries(args)) {
        const propSchema = schema.properties[key];
        if (!propSchema) {
          if (schema.additionalProperties === false) {
            errors.push(`Unknown parameter: '${key}'`);
          }
          continue;
        }

        const typeError = this.validateType(key, value, propSchema);
        if (typeError) {
          errors.push(typeError);
        }
      }
    }

    return errors.length > 0 ? { valid: false, errors } : { valid: true };
  }

  /**
   * Validates a value against a JSON schema property type
   */
  private validateType(key: string, value: unknown, schema: JSONSchemaProperty): string | null {
    const actualType = Array.isArray(value) ? 'array' : typeof value;
    
    if (schema.type !== actualType) {
      return `Parameter '${key}' must be of type '${schema.type}', got '${actualType}'`;
    }

    // Validate enum values
    if (schema.enum && typeof value === 'string') {
      if (!schema.enum.includes(value)) {
        return `Parameter '${key}' must be one of: ${schema.enum.join(', ')}`;
      }
    }

    // Validate array items
    if (schema.type === 'array' && Array.isArray(value) && schema.items) {
      for (let i = 0; i < value.length; i++) {
        const itemError = this.validateType(`${key}[${i}]`, value[i], schema.items);
        if (itemError) {
          return itemError;
        }
      }
    }

    return null;
  }

  /**
   * Executes a tool call
   * Requirements: 6.2, 6.4, 6.5
   */
  async execute(call: ToolCall): Promise<ToolResult> {
    const tool = this.tools.get(call.name);

    // Check if tool exists
    if (!tool) {
      return {
        callId: call.id,
        success: false,
        error: {
          toolName: call.name,
          errorType: 'not_found',
          message: `Tool '${call.name}' is not registered`,
        },
      };
    }

    // Validate parameters
    const validation = this.validateParameters(call.name, call.arguments);
    if (!validation.valid) {
      return {
        callId: call.id,
        success: false,
        error: {
          toolName: call.name,
          errorType: 'validation',
          message: `Parameter validation failed: ${validation.errors?.join('; ')}`,
          details: validation.errors,
        },
      };
    }

    // Execute the tool handler
    try {
      const output = await tool.handler(call.arguments);
      return {
        callId: call.id,
        success: true,
        output,
      };
    } catch (error) {
      return {
        callId: call.id,
        success: false,
        error: {
          toolName: call.name,
          errorType: 'execution',
          message: error instanceof Error ? error.message : String(error),
          details: error instanceof Error ? { stack: error.stack } : undefined,
        },
      };
    }
  }
}
