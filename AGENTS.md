# Project Agents

See `.rust-skills/AGENTS.md` for Rust development guidelines.

# Source code rules

Add RustDoc comments to all source code artefacts (functions, structs, enums, etc.).

For CLI code, keep each command or command family in its own source file rather
than growing a single monolithic `cli` module.

For every significant new artefact or new feature of an existing artefact, create a unit test and run it.

After the completion of a large task or work package, run all unit tests to ensure all functionality is still valid.

<!-- lean-ctx -->
## lean-ctx

lean-ctx is active — the MCP tools replace native equivalents.
Full rules: LEAN-CTX.md (open on demand — do not auto-load).
<!-- /lean-ctx -->
