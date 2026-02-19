# Template Selection Guide

## Choosing the Right Template

### General Technical Specification Template
**Use `assets/general-techspec-template.md` for:**

#### Feature Development
- Adding new functionality to existing systems
- Modifying or enhancing current features
- Cross-team technical proposals
- Problem-solution focused documentation

#### Examples:
- "Add user authentication to the web app"
- "Implement search functionality"
- "Create an admin dashboard"
- "Add payment processing integration"

#### Key Characteristics:
- Problem-driven approach
- Emphasis on current vs. proposed solutions
- Strong focus on implementation planning
- Detailed impact analysis for existing systems

### System Design Template
**Use `assets/system-design-template.md` for:**

#### Architecture Documentation
- Documenting existing system architecture
- Designing new systems from scratch
- Scalability and performance planning
- Infrastructure-focused specifications

#### Examples:
- "Design a microservices architecture"
- "Document the current API system"
- "Plan a real-time messaging system"
- "Create architecture for a distributed cache"

#### Key Characteristics:
- Architecture-first approach
- Strong emphasis on non-functional requirements
- Detailed scalability and reliability considerations
- Component and data flow focus

## Decision Matrix

| Scenario | Recommended Template | Key Factors |
|----------|---------------------|-------------|
| New feature in existing app | General Tech Spec | Integration with existing system |
| Greenfield project | System Design | Starting from scratch |
| Performance improvement | System Design | Non-functional requirements focus |
| Bug fix or refactoring | General Tech Spec | Problem-solution approach |
| API documentation | System Design | Interface and contract focus |
| Cross-service integration | General Tech Spec | Impact on multiple teams |
| Infrastructure planning | System Design | Scalability and ops focus |
| Business logic changes | General Tech Spec | Requirements and implementation |

## Template Adaptation Guidelines

### Flexibility is Key
- **Remove unused sections** that don't apply to your specific case
- **Add custom sections** when standard templates don't cover your needs
- **Merge approaches** for complex specifications that need both perspectives

### Common Adaptations

#### For Small Projects
- Combine "Architecture" and "Implementation" sections
- Skip detailed cost analysis if not relevant
- Reduce formality in smaller team contexts

#### For Large Systems
- Split architecture into multiple detailed sections
- Add more detailed dependency analysis
- Include explicit migration and rollback plans

#### For API-First Projects
- Expand API design sections significantly
- Add detailed contract specifications
- Include versioning and backward compatibility

#### For Data-Heavy Systems
- Expand data model sections
- Add data migration considerations
- Include privacy and compliance sections

## Section Customization Examples

### When Adding Sections
**Real-time Systems:** Add "Latency Requirements" and "Event Processing"
**Mobile Apps:** Add "Offline Capabilities" and "Battery Optimization"
**ML Systems:** Add "Model Training" and "Data Pipeline"
**Security Systems:** Add "Threat Modeling" and "Compliance Requirements"

### When Removing Sections
**Internal Tools:** Skip "Cost Analysis" if not budget-constrained
**Proof of Concepts:** Remove detailed "Implementation Plan"
**Documentation Projects:** Skip "Testing Strategies"
**Simple Integrations:** Remove extensive "Failure Modes" analysis

## Quality Checklist

### Good Technical Specifications Include:
- [ ] Clear problem statement and context
- [ ] Specific, measurable success criteria
- [ ] Realistic implementation timeline
- [ ] Identified risks and mitigation strategies
- [ ] Clear scope boundaries (what's included/excluded)

### Red Flags in Specifications:
- [ ] Vague requirements without measurable outcomes
- [ ] Missing consideration of existing system impact
- [ ] No discussion of failure scenarios
- [ ] Unrealistic timelines or resource estimates
- [ ] Missing stakeholder identification