# `@ubiquity-os/daemon-pricing`

Helps settings prices and adds label to the issues accordingly.

## Technical Architecture

### Overview

The daemon-pricing service is a Cloudflare Workers-based application that automates pricing-related operations for GitHub issues. It processes webhook events to manage pricing labels and configurations across Ubiquity repositories.

### Core Components

1. **Plugin System**

   - Built on `@ubiquity-os/plugin-sdk` for standardized plugin architecture
   - Handles GitHub webhook events using `@octokit/webhooks`
   - Supports environment-specific configurations through `envSchema`
   - Implements error handling with automatic issue commenting

2. **Label Management System**

   - Automated pricing label creation and management
   - Supports time-based and priority-based labeling
   - Implements hierarchical label organization
   - Handles parent-child issue relationships
   - Automatic price calculation based on time and priority labels

3. **Permission System**

   - Fine-grained access control for label management
   - Collaborator-specific label permissions
   - Public access control configuration
   - Repository-specific exclusion rules

4. **GitHub Integration**
   - OAuth App-based authentication
   - Webhook event processing
   - Issue and label manipulation through GitHub API
   - Support for repository-specific configurations

### Technology Stack

- **Runtime**: Cloudflare Workers (Serverless)
- **Language**: TypeScript
- **Key Dependencies**:
  - `@octokit/rest`: GitHub API client
  - `@sinclair/typebox`: Runtime type checking
  - `decimal.js`: Precise numerical calculations
  - `hono`: Lightweight web framework

### Development Tools

- **Testing**: Jest with comprehensive test suite
- **Linting**: ESLint with TypeScript support
- **Formatting**: Prettier
- **Spell Checking**: CSpell
- **Git Hooks**: Husky for pre-commit checks
- **Local Development**: Wrangler for Workers simulation

## Usage

Example of valid configuration:

```yml
- plugin: https://ubiquity-os-daemon-pricing.ubq.fi
  with:
    labels:
      time:
        - name: "Time: <1 Hour"
          collaboratorOnly: false
        - name: "Time: <2 Hours"
          collaboratorOnly: false
        - name: "Time: <4 Hours"
          collaboratorOnly: false
        - name: "Time: <1 Day"
          collaboratorOnly: false
        - name: "Time: <1 Week"
          collaboratorOnly: false
      priority:
        - name: "Priority: 1 (Normal)"
          collaboratorOnly: false
        - name: "Priority: 2 (Medium)"
          collaboratorOnly: true
        - name: "Priority: 3 (High)"
          collaboratorOnly: false
        - name: "Priority: 4 (Urgent)"
          collaboratorOnly: false
        - name: "Priority: 5 (Emergency)"
          collaboratorOnly: false
    basePriceMultiplier: 1
    publicAccessControl:
      setLabel: true
      fundExternalClosedIssue: false
      protectLabels:
        - price
        - time
        - priority
    globalConfigUpdate:
      excludeRepos: ["devpool-directory", "devpool-directory-private"]
```

## Running locally

### Supabase

Supabase can be started through the CLI running

```shell
supabase start
```

### Worker

Start the Worker by running

```shell
bun run worker
```

### Make requests

To trigger the worker, `POST` requests should be made to http://localhost:4000 with a `Content-Type: application/json`
header and a body
looking like

```json
{
  "stateId": "",
  "eventName": "",
  "eventPayload": "",
  "settings": "",
  "ref": ""
}
```

For convenience, you can find an `.http` file with a valid request [here](/tests/http/request.http).

## Testing

### Jest

To start Jest tests, run

```shell
bun run test
```
