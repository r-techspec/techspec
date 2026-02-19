# Codebase Analysis Guide

## Documentation-First Exploration

### 1. Start with High-Level Documentation
- **README files** - Understand purpose, setup, basic architecture
- **Documentation folders** (`docs/`, `documentation/`, `.github/`)
- **Architecture diagrams** - Look for existing system overviews
- **API documentation** - Swagger/OpenAPI specs, endpoint docs
- **Contributing guides** - Often contain architectural insights

### 2. Configuration and Deployment
- **Package files** (`package.json`, `requirements.txt`, `Cargo.toml`, etc.)
- **Docker files** - Understanding deployment and dependencies
- **Environment configs** - Feature flags, service configurations
- **CI/CD files** (`.github/workflows/`, `.gitlab-ci.yml`) - Build and deploy processes

## Entry Point Discovery

### Web Applications
- **Server entry points**: `main.py`, `app.js`, `server.ts`, `index.php`
- **Route definitions**: Express routes, Django URLs, Rails routes
- **Frontend entry**: `index.html`, `App.js/jsx`, `main.ts`

### APIs and Microservices
- **Route handlers**: REST endpoints, GraphQL resolvers
- **Middleware chains**: Authentication, logging, validation
- **Database connections**: ORM configurations, connection pooling

### CLI Tools and Libraries
- **Main functions**: Entry points in various languages
- **Command definitions**: CLI argument parsing, subcommands
- **Public interfaces**: Exported functions, classes, modules

## Core Functionality Tracing

### Follow User Journeys
1. **Identify primary user actions** (login, create post, process payment)
2. **Trace request flow** from entry point to response
3. **Map data transformations** at each step
4. **Document external calls** (APIs, databases, queues)

### Architectural Pattern Recognition
- **MVC/MVP patterns**: Controllers, models, views
- **Microservices**: Service boundaries, inter-service communication
- **Event-driven**: Event publishers, subscribers, message queues
- **Layered architecture**: Presentation, business logic, data layers

### Data Flow Analysis
- **Input validation**: Where and how data is validated
- **Business logic**: Core algorithms and decision points
- **Data persistence**: Database operations, caching strategies
- **Output formatting**: Response serialization, template rendering

## Smart Scoping Strategies

### Focus on Core Value
- **Primary business logic** over administrative features
- **Main user workflows** over edge cases and error handling
- **Critical path operations** over optimization and monitoring

### Examples of Core vs. Auxiliary
**E-commerce Platform:**
- **Core**: Product catalog, shopping cart, checkout, payments
- **Auxiliary**: Admin dashboards, analytics, A/B testing

**Social Platform:**
- **Core**: User profiles, content posting, feed generation, following
- **Auxiliary**: Live streaming, advanced search, content moderation tools

**API Service:**
- **Core**: Authentication, main endpoints, data processing
- **Auxiliary**: Rate limiting, caching, monitoring dashboards

## Analysis Anti-Patterns to Avoid

### Don't Get Lost in Details
- Avoid deep-diving into utility functions initially
- Skip over-analyzing error handling and edge cases first
- Don't document every single endpoint/function

### Don't Ignore Context
- Always read comments and docstrings for context
- Look for TODO/FIXME comments that reveal intentions
- Check git history for major architectural decisions

### Don't Assume Perfect Code
- Real codebases have technical debt and workarounds
- Legacy code may not follow current patterns
- Document what exists, not what should exist

## Effective Documentation Reading

### Code Comments Priority
1. **File-level headers** - Module purpose and overview
2. **Class/function docstrings** - API contracts and behavior
3. **Inline comments** - Complex logic explanations
4. **TODO/FIXME comments** - Planned changes and known issues

### README Scanning Technique
- **Purpose section** - What problem does this solve?
- **Architecture section** - High-level design overview
- **Getting started** - Entry points and key workflows
- **API docs** - Interface definitions and usage examples

### Configuration File Insights
- **Environment variables** - External service dependencies
- **Feature flags** - Conditional functionality paths
- **Database configs** - Data architecture and relationships
- **Service discovery** - Microservice topology