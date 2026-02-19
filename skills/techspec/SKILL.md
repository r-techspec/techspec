---
name: techspec
description: Generate comprehensive technical specifications and design documents from existing codebases. Use when users request: (1) Tech specs or technical specifications for systems, (2) Design documents or system design docs, (3) Architecture documentation for codebases, (4) Documentation of core functionality and code paths. Focuses on identifying core functionality rather than exhaustive coverage - analyzes entry points, main workflows, and key architectural patterns.
---

# Technical Specification Generator

Generate comprehensive technical specifications from existing codebases by analyzing core functionality, entry points, and architectural patterns.

## Core Analysis Approach

### 1. Documentation-First Analysis
- Start with README files, documentation folders, and inline comments
- Look for architecture diagrams, API docs, and existing specifications
- Understand the system's purpose and high-level design before diving into code

### 2. Entry Point Discovery
- Identify main entry points: `main()` functions, server startup files, API route definitions
- Follow the primary user journeys and core business logic flows
- Focus on the "happy path" through the system rather than edge cases

### 3. Core Functionality Mapping
- Trace the most important user workflows end-to-end
- Document key architectural patterns (MVC, microservices, event-driven, etc.)
- Identify critical data flows and external dependencies

### 4. Smart Scoping
- Prioritize core features over auxiliary functionality
- Example: For a social platform, focus on posting/timeline/following rather than advanced features like live streaming
- Document the 20% of code that handles 80% of the business value

## Available Templates

Choose the appropriate template based on the specification type:

### General Technical Specification
Use `assets/general-techspec-template.md` for:
- Feature specifications
- System overviews
- Problem-solution documentation
- Cross-team technical proposals

### System Design Specification
Use `assets/system-design-template.md` for:
- Architecture documentation
- Scalability planning
- New system designs
- Performance and reliability specs

### Custom Templates
Additional templates can be added to the `assets/` directory as needed.

## Analysis References

For detailed guidance on codebase analysis:
- See `references/analysis-guide.md` for systematic code exploration techniques
- See `references/template-guide.md` for when to use which template type

## Output Format

Generate the specification as a markdown file in the project root or docs folder, following the selected template structure while adapting sections based on the actual codebase findings.