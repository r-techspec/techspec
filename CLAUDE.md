# TechSpec

A collection of fun-to-read technical specifications and minimal viable implementations (MVPs) of open source projects — built for learning how things work under the hood.

## Project Structure

```
techspecs/
  <project-name>/
    TECHSPEC.md    # The technical specification
    mvp/           # Minimal viable implementation of core functionality
skills/
  techspec/        # Claude skill for generating tech specs from codebases
```

## How It Works

Each project gets two artifacts:

1. **TECHSPEC.md** — A readable, opinionated breakdown of how the project is architected. Not a formal design doc — more like "here's how this thing actually works" written for someone who wants to understand the internals.

2. **mvp/** — A stripped-down implementation of the project's core mechanics. Not production code. Just enough to demonstrate the key ideas and make them concrete.

## Conventions

- Tech specs live in `techspecs/<project-name>/TECHSPEC.md`
- MVPs live in `techspecs/<project-name>/mvp/`
- Each MVP should have its own README explaining what it demonstrates and how to run it
- Tech specs should be fun to read — skip the boilerplate, focus on the interesting bits
- Use the `/techspec` skill to generate specs from real codebases

## Current Projects

- **openclaw** — A self-hosted AI assistant that connects to your messaging apps (Telegram, Slack, Discord, WhatsApp). TypeScript, file-based storage, flat agent architecture.
