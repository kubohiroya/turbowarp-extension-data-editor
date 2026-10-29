# turbowarp-extension-data-editor

English | [日本語](README.ja.md)

An experimental shared API v1 for editing structured data used by TurboWarp extensions through forms and custom UIs.
This package implements [shared infrastructure #1](https://github.com/kubohiroya/turbowarp-extension-data-editor/issues/1) and
[GUI integration #1](https://github.com/kubohiroya/scratch-gui/issues/1).

Japanese guides for usage, APIs, GUI integration, publishing, and validation records are collected in the [documentation index](docs/README.md).

For tabs, groups, and grids, see the [shared layout guide (Japanese)](docs/common-layout.ja.md). Standard RJSF and Source/Form use the same JSON declarations, enabled by the host's startup flag `commonLayout` (off by default).

This package is a library. The downstream [TurboWarp-Plus-Editor](https://github.com/kubohiroya/turbowarp-plus-editor) owns the integrated Editor build, validation and GitHub Pages distribution. This repository no longer provides GitHub Pages; its former URL does not serve an Editor or a redirect.

<p><a class="twpe-edit-button" href="https://kubohiroya.github.io/turbowarp-plus-editor/editor.html?lang=en"><img src="https://kubohiroya.github.io/turbowarp-plus-editor/assets/icon.svg" width="32" height="32" alt=""> Edit in TurboWarp-Plus-Editor</a></p>

See the [TurboWarp-Plus-Editor README](https://github.com/kubohiroya/turbowarp-plus-editor#edit-button) for the reusable button HTML and stylesheet.

## Standard JSON Schema editor

Declare a string argument containing JSON/YAML and a JSON Schema, and react-jsonschema-form generates the form.
The GUI registration API detects `schema` and selects the standard editor. No custom editor body is needed.

```js
const unregister = Scratch.gui.blockEditors.register({
  apiVersion: 1,
  extensionId: 'story',
  editorId: 'properties',
  opcodes: ['story_scene'],
  argument: 'PROPERTIES',
  format: 'yaml', // Omit for JSON compatibility.
  schema: {
    type: 'object',
    properties: {
      label: {type: 'string', minLength: 1, title: 'Name'},
      duration: {type: 'number', minimum: 1, maximum: 60, title: 'Seconds'}
    },
    required: ['label', 'duration'],
    additionalProperties: false
  },
  uiSchema: {'ui:order': ['label', 'duration']}
});
```

`registerSchema()` can also register the standard editor explicitly.
The Save button is disabled while validation errors exist, including missing required fields, invalid types, or out-of-range values. Data is always validated again when saving.
An optional asynchronous `validateData(data, snapshot)` adds business validation at save time.
Schema validation uses AJV 8; rendering uses RJSF 5.24.13, compatible with React 16.14.
The baseline supports JSON Schema draft-07 and local references. External references are never fetched, and unresolved references are rejected during registration.
Schema `default` values populate the draft without writing to the original block until saving.

Set `format: 'json' | 'yaml'`; omitting it preserves the existing JSON behavior.
For YAML, the host's `yaml` 2.x decodes a single YAML 1.2 core document,
validates it against the same Schema as JSON, and encodes it in the specified format.
Supported values are mappings with string keys, sequences, finite numbers, strings, booleans, and null.
Duplicate keys, non-string keys, custom tags, non-finite numbers, cyclic aliases, multiple documents, and YAML 1.1 are rejected without changing the original argument.
Non-cyclic aliases are expanded within limits. Merge keys receive no special expansion.
Saving unchanged data preserves the original string, including comments and whitespace, without committing.
Saving changed data preserves its meaning, but does not guarantee preservation of comments, quoting, anchors, or key order.
Additional properties outside the form are retained whenever the Schema permits them.
For GUI integration with webpack 4, use the [compatibility distribution and configuration API (Japanese)](docs/webpack4.md); this package handles RJSF/YAML transpilation.

## API and transactions

The root `EditorRegistry` / `EditorSession` APIs have no React or Blockly dependency.
`createSchemaEditor()` from `@kubohiroya/turbowarp-extension-data-editor/rjsf` provides the standard form.
You can also register definitions with a `mount()` implementation using plain DOM or a custom React UI.
`createBlockEditorService()` from `/rjsf` provides Schema detection, registration, unregistration, and notifications.
`BlockEditorDialog` from `/react` provides Save/Cancel controls, errors, and a hierarchical UI, with the host injecting its Modal, translations, and theme.
Load `/react/styles.css` through the host's CSS Modules configuration.

Each session holds an initial snapshot and an independent JSON draft. Canceling discards changes.
Saving passes validation, an argument allowlist, reporter protection, and conflict checks before requesting a single change from the host.
The GUI host synchronizes the workspace and VM, grouping the save into one Undo/Redo step. The host also restores state on failure.
`session.reference` identifies the target and block. Unmounting the editor body preserves the draft and errors for remounting.
Updates from detached views are rejected, view subscriptions are released, and standard form field IDs are isolated per view.
See the [API and host contract (Japanese)](docs/api.md) for details.

## TurboWarp integration

Pass the host's ScratchBlocks, VM, workspace, registration service, and UI callbacks to
`attachTurboWarpBlockEditors()` from `/turbowarp` to connect icon decorations, session opening, VM synchronization, and batch saves.
`enabled` / `descendants` default to off; the returned object provides `refresh()` and an idempotent `dispose()`.
The GUI remains responsible for lifecycle management and connecting its Modal, translations, and theme.
See the [TurboWarp adapter API (Japanese)](docs/turbowarp-adapter.md).

## Hierarchical sessions for descendants

As an additional API for [shared infrastructure #2](https://github.com/kubohiroya/turbowarp-extension-data-editor/issues/2),
the package provides `EditorRegistry.openDescendants()` and `DescendantSession`.
Use them only when the host provides the `descendant-editing-v1` capability, a complete subtree snapshot, and batch commits.
They reuse existing API v1 editor bodies, retain drafts and validation results across parents, descendants, and multiple branches, and pass all changes to the host in one operation.
Unregistered intermediate nodes remain in the structure, and hidden nodes are also validated. Sessions handle structural, value, and registration conflicts, limits, and invalidation during asynchronous operations.

Limits are 500 nodes and a depth of 32. The GUI provides hierarchical editing by default, falling back to existing single-block editing on unsupported hosts.
See the [hierarchical session contract (Japanese)](docs/descendants.md) for details and domain-independent examples.
Real GUI traversal, hierarchical modals, batch Undo/Redo, and `.sb3` integration checks require the integration tracked in scratch-gui #2.

## Local validation

Use Node.js 24 or later and pnpm.

```sh
pnpm install
pnpm typecheck
pnpm test
```

`pnpm test` builds the package, including type declarations, then runs the core and standard form tests.
The package uses ESM. Browsers need ES2022 built-in APIs.
The standard form supports React / ReactDOM peers 16.14, 17, and 18. The GUI shares its existing React 16.14 installation.
The first experimental release was `@kubohiroya/turbowarp-extension-data-editor@0.1.0`. Fixed-schema Source/Form editing was added in `0.2.0`; default-off fixed-input contracts, standard field transactions, fixed-input forms, and GUI integration followed in `0.2.1`. Release `0.2.2` includes block names and icons in editor headings, field removal menus and add buttons, and two-line key-value layouts.

```sh
npm install --save-exact @kubohiroya/turbowarp-extension-data-editor@0.2.2
```

See [package distribution (Japanese)](docs/package-distribution.md) for artifacts, compatibility after renaming, and publishing procedures.

## Try it in the GUI

`scratch-gui` pins this package to a validated exact npm version or a full Git SHA. Normal GUI builds do not require an adjacent checkout of this shared repository.
Follow the [GUI startup, limitations, and validation guide (Japanese)](docs/block-editor.md).
Click an existing extension icon to edit a draft in the standard modal.

The existing SOURCE path handles JSON/YAML strings stored in ordinary text shadows on blocks already placed in the workspace. This path does not modify reporters, menus, or fields with custom validators. On supported hosts, the fixed-input path handles static menus, numbers, and colors without evaluating or replacing reporters or dynamic menus.
For `.sb3` saving, reloading through `project_url` and the OS file picker, English/Japanese display, themes, and the scope of validation, see [GUI integration E2E (Japanese)](docs/block-editor-e2e.md) and the [fixed-input contract (Japanese)](docs/fixed-input-contracts.md).

## Default behavior and rollback

Supported GUIs provide dialogs, source forms, shared layouts, fixed inputs, descendant editing, and batch security confirmation by default.
These are available at the normal `editor.html?lang=ja` URL without activation switches. Low-level API host capability negotiation remains in place.
To roll back, revert the GUI changes together with TurboWarp-Plus-Editor's pinned source configuration.
Committed values are stored in existing arguments. UI state, drafts, functions, and revisions are not added to project data.

## webpack 4 / E2E

See the [webpack 4 distribution and configuration API (Japanese)](docs/webpack4.md) and [GUI integration E2E and CI procedures (Japanese)](docs/block-editor-e2e.md). This shared repository manages the custom editor UI and compatibility builds. The GUI owns host integration, and TurboWarp-Plus-Editor owns integrated builds, E2E tests and distribution.

## Shared Schema types and diagnostic conversion

`@kubohiroya/turbowarp-extension-data-editor/schema` is an entry point that loads no DOM, React, or RJSF code. It exports types for Schema bundles, authoritative/generated/reference roles, diagnostics and results by processing stage, and synchronous owner validation.

`toValidationIssues()` converts input diagnostics into existing `ValidationIssue` values, returning frozen results that preserve JSON Pointer paths, ordering, and counts. Invalid diagnostics and compile/execution diagnostics are rejected with a TypeError. Existing RJSF paths and the save-time-only asynchronous `validateData` contract remain unchanged.

`compileSchemaBundle()` builds an offline synchronous validator from draft-07/2020-12 and bundled resources. It returns structured diagnostics without modifying the Schema or input. See the [pure validation API (Japanese)](docs/schema.md). Synchronous owner composition and an RJSF path for explicit bundles are also available. Existing public entry points, webpack4/build-info, and CSS builds are retained.

Use `validateSchemaInput` from `/schema` for synchronous owner validation. Register explicit-bundle forms with `createSchemaBundleEditor` / `registerSchemaBundle` from `/rjsf`. A context provider supplies the time and configuration for each call. See the [Schema infrastructure guide (Japanese)](docs/schema.md) for UI support and treatment of existing APIs.

The cross-repository validation record collected when introducing the existing SOURCE contract covers **14 contracts across 8 packages**. See the [revalidation procedure after Template separation (Japanese)](docs/template-fixture-separation.ja.md#current-verification) for the isolation index excluding Template and the two validation commands. This introduction record distinguishes 14 production contracts from 9 fixed-input contracts. For fixed-input implementation and GUI integration, see the final contract section below. Earlier results for 16 contracts across 9 packages and their starting conditions are retained in the [stage 1 history (Japanese)](docs/schema-stage1.ja.md).

## Optional editing examples

Repository examples are opt-in teaching code, not template blocks or additional package exports. See [the JSON/YAML document example](examples/document-properties.mjs) and [its guide (Japanese)](examples/README.ja.md). Each extension owns its actual data contract.

Prepared source editing is an optional host capability. See [the source/form contract (Japanese)](docs/source-forms.ja.md) for fixed-schema bindings, atomic saves, compatibility, and rollback.

## Fixed inputs and GUI integration (S3-1–S3-3)

The package includes fixed-input types, Schema checks, and synchronous prepared contracts. New registration APIs are exposed only when explicitly setting `createBlockEditorService({fixedInputs: true})`, and editors cannot open without a compatible host. Setting `enableFixedInputs: true` on the lower-level host enables reading standard fields and saving atomically. Fixed-input forms and integration with the GUI's default-off flags are also included. Each extension owns its authoritative Schema, codec, and registration. See the [fixed-input contract (Japanese)](docs/fixed-input-contracts.md). Distribution artifacts record the original Git SHA separately from the working-tree release overlay that includes version updates.
